import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { hasRole } from '@/lib/auth/has-role'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { CreateJobSchema, type CreateJobInput } from '@/lib/validations/job'
import { haversineDistanceKm } from '@/lib/geo'

type ServiceClient = ReturnType<typeof createServiceClient>

async function assertActiveCategory(supabase: ServiceClient, categoryId: string): Promise<void> {
  const { data, error } = await supabase
    .from('job_categories')
    .select('id, is_active')
    .eq('id', categoryId)
    .maybeSingle()

  if (error || !data || !data.is_active) {
    throw appError('VALIDATION_ERROR', 'Kategori tidak valid.')
  }
}

export async function createJob(input: CreateJobInput): Promise<{ id: string }> {
  const user = await requireRole('employer')
  const validated = CreateJobSchema.parse(input)

  const supabase = createServiceClient()
  await assertActiveCategory(supabase, validated.categoryId)

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      employer_id: user.id,
      category_id: validated.categoryId,
      title: validated.title,
      description: validated.description,
      address: validated.address,
      latitude: validated.latitude,
      longitude: validated.longitude,
      payment_amount: validated.paymentAmount,
      duration_minutes: validated.durationMinutes,
      deadline: validated.deadline.toISOString(),
      status: 'open',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw appError('INTERNAL_ERROR')
  }

  return { id: data.id }
}

export async function updateJob(jobId: string, input: CreateJobInput): Promise<void> {
  const user = await requireRole('employer')
  const validated = CreateJobSchema.parse(input)

  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }
  if (job.status !== 'open') {
    throw appError('CONFLICT', 'Pekerjaan yang sudah tidak berstatus "open" tidak dapat diedit.')
  }

  await assertActiveCategory(supabase, validated.categoryId)

  const { error } = await supabase
    .from('jobs')
    .update({
      category_id: validated.categoryId,
      title: validated.title,
      description: validated.description,
      address: validated.address,
      latitude: validated.latitude,
      longitude: validated.longitude,
      payment_amount: validated.paymentAmount,
      duration_minutes: validated.durationMinutes,
      deadline: validated.deadline.toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
}

export interface JobSummary {
  id: string
  title: string
  categoryId: string
  status: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  createdAt: string
}

export async function getOwnJobs(): Promise<JobSummary[]> {
  const user = await requireRole('employer')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, category_id, status, payment_amount, duration_minutes, deadline, created_at')
    .eq('employer_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map((job) => ({
    id: job.id,
    title: job.title,
    categoryId: job.category_id,
    status: job.status,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    createdAt: job.created_at,
  }))
}

export interface JobListingFilters {
  keyword?: string
  categoryId?: string
  minPayment?: number
  maxPayment?: number
  workerLat?: number
  workerLng?: number
  radiusKm?: number
}

export interface JobListing {
  id: string
  title: string
  categoryId: string
  address: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  distanceKm: number | null
}

async function getDefaultJobRadiusKm(supabase: ServiceClient): Promise<number> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'default_job_radius_km')
    .maybeSingle()

  return typeof data?.value === 'number' ? data.value : 10
}

export async function getJobListing(filters: JobListingFilters): Promise<JobListing[]> {
  await getCurrentUser()
  const supabase = createServiceClient()

  let query = supabase
    .from('jobs')
    .select(
      'id, title, category_id, address, latitude, longitude, payment_amount, duration_minutes, deadline, created_at'
    )
    .eq('status', 'open')

  if (filters.keyword) {
    query = query.ilike('title', `%${filters.keyword}%`)
  }
  if (filters.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (filters.minPayment !== undefined) {
    query = query.gte('payment_amount', filters.minPayment)
  }
  if (filters.maxPayment !== undefined) {
    query = query.lte('payment_amount', filters.maxPayment)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = data ?? []
  const hasLocation = filters.workerLat !== undefined && filters.workerLng !== undefined

  let jobs: JobListing[] = rows.map((job) => ({
    id: job.id,
    title: job.title,
    categoryId: job.category_id,
    address: job.address,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    distanceKm: hasLocation
      ? haversineDistanceKm(
          { latitude: filters.workerLat as number, longitude: filters.workerLng as number },
          { latitude: job.latitude, longitude: job.longitude }
        )
      : null,
  }))

  if (hasLocation) {
    const radiusKm = filters.radiusKm ?? (await getDefaultJobRadiusKm(supabase))
    jobs = jobs
      .filter((job) => job.distanceKm !== null && job.distanceKm <= radiusKm)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
  }

  return jobs
}

export interface JobDetail {
  id: string
  title: string
  description: string
  address: string
  latitude: number
  longitude: number
  categoryId: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  status: string
  employerId: string
}

export async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const supabase = createServiceClient()
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      'id, title, description, address, latitude, longitude, category_id, payment_amount, duration_minutes, deadline, status, employer_id, assigned_worker_id'
    )
    .eq('id', jobId)
    .maybeSingle()

  if (error || !job) {
    return null
  }

  const isVisible =
    job.status === 'open' ||
    job.employer_id === user.id ||
    job.assigned_worker_id === user.id ||
    hasRole(user.roles.map((role) => ({ role })), 'admin')

  if (!isVisible) {
    return null
  }

  return {
    id: job.id,
    title: job.title,
    description: job.description,
    address: job.address,
    latitude: job.latitude,
    longitude: job.longitude,
    categoryId: job.category_id,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    status: job.status,
    employerId: job.employer_id,
  }
}
