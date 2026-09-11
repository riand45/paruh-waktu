import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { getJobDetail } from '@/lib/services/jobs'

export interface AdminJobSummary {
  id: string
  title: string
  status: string
  categoryId: string
  categoryName: string
  employerId: string
  employerName: string
  assignedWorkerId: string | null
  assignedWorkerName: string | null
  createdAt: string
}

export interface AdminJobFilters {
  search?: string
  status?: string
  categoryId?: string
}

export async function getJobsForAdmin(filters: AdminJobFilters = {}): Promise<AdminJobSummary[]> {
  await requireRole('admin')
  const supabase = createServiceClient()

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, status, category_id, employer_id, assigned_worker_id, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = jobs ?? []
  if (rows.length === 0) {
    return []
  }

  const categoryIds = [...new Set(rows.map((row) => row.category_id))]
  const { data: categories, error: categoriesError } = await supabase
    .from('job_categories')
    .select('id, name')
    .in('id', categoryIds)
  if (categoriesError) {
    throw appError('INTERNAL_ERROR')
  }
  const categoryNameById = new Map((categories ?? []).map((category) => [category.id, category.name]))

  const profileIds = [
    ...new Set([
      ...rows.map((row) => row.employer_id),
      ...rows.filter((row) => row.assigned_worker_id).map((row) => row.assigned_worker_id as string),
    ]),
  ]
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', profileIds)
  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  let result: AdminJobSummary[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    categoryId: row.category_id,
    categoryName: categoryNameById.get(row.category_id) ?? 'Tidak diketahui',
    employerId: row.employer_id,
    employerName: nameById.get(row.employer_id) ?? 'Tidak diketahui',
    assignedWorkerId: row.assigned_worker_id,
    assignedWorkerName: row.assigned_worker_id ? (nameById.get(row.assigned_worker_id) ?? 'Tidak diketahui') : null,
    createdAt: row.created_at,
  }))

  if (filters.search) {
    const term = filters.search.toLowerCase()
    result = result.filter((row) => row.title.toLowerCase().includes(term))
  }
  if (filters.status) {
    result = result.filter((row) => row.status === filters.status)
  }
  if (filters.categoryId) {
    result = result.filter((row) => row.categoryId === filters.categoryId)
  }

  return result
}

export interface AdminJobDetail {
  id: string
  title: string
  description: string
  address: string
  status: string
  categoryId: string
  categoryName: string
  employerId: string
  employerName: string
  assignedWorkerId: string | null
  assignedWorkerName: string | null
  paymentAmount: number
  durationMinutes: number
  deadline: string
  cancelledReason: string | null
  paymentStatus: string | null
  createdAt: string
}

export async function getJobDetailForAdmin(jobId: string): Promise<AdminJobDetail | null> {
  await requireRole('admin')
  const job = await getJobDetail(jobId)
  if (!job) {
    return null
  }

  const supabase = createServiceClient()

  const { data: category } = await supabase
    .from('job_categories')
    .select('name')
    .eq('id', job.categoryId)
    .maybeSingle()

  const { data: employerProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', job.employerId)
    .maybeSingle()

  let assignedWorkerName: string | null = null
  if (job.assignedWorkerId) {
    const { data: workerProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', job.assignedWorkerId)
      .maybeSingle()
    assignedWorkerName = workerProfile?.full_name ?? 'Tidak diketahui'
  }

  const { data: payment } = await supabase.from('payments').select('status').eq('job_id', jobId).maybeSingle()

  return {
    id: job.id,
    title: job.title,
    description: job.description,
    address: job.address,
    status: job.status,
    categoryId: job.categoryId,
    categoryName: category?.name ?? 'Tidak diketahui',
    employerId: job.employerId,
    employerName: employerProfile?.full_name ?? 'Tidak diketahui',
    assignedWorkerId: job.assignedWorkerId,
    assignedWorkerName,
    paymentAmount: job.paymentAmount,
    durationMinutes: job.durationMinutes,
    deadline: job.deadline,
    cancelledReason: job.cancelledReason,
    paymentStatus: payment?.status ?? null,
    createdAt: job.createdAt,
  }
}

function mapCancelJobError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('use cancel_job_and_refund')) {
    return appError('CONFLICT', 'Pekerjaan ini memiliki pembayaran terverifikasi — gunakan alur refund.')
  }
  if (message.includes('already cancelled or completed')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah dibatalkan atau selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function cancelJob(jobId: string, reason: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('cancel_job', {
    p_job_id: jobId,
    p_reason: reason,
  })

  if (error) {
    throw mapCancelJobError(error.message)
  }
}
