import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import { ApplyToJobSchema, type ApplyToJobInput } from '@/lib/validations/application'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function applyToJob(jobId: string, input: ApplyToJobInput): Promise<{ id: string }> {
  const user = await requireRole('worker')
  const validated = ApplyToJobSchema.parse(input)

  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id === user.id) {
    throw appError('FORBIDDEN', 'Anda tidak dapat melamar pekerjaan milik sendiri.')
  }
  if (job.status !== 'open') {
    throw appError('CONFLICT', 'Pekerjaan ini sudah tidak menerima lamaran.')
  }

  const { data, error } = await supabase
    .from('job_applications')
    .insert({
      job_id: jobId,
      worker_id: user.id,
      message: validated.message || null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw appError('CONFLICT', 'Anda sudah memiliki lamaran aktif untuk pekerjaan ini.')
    }
    throw appError('INTERNAL_ERROR')
  }

  return { id: data.id }
}

export async function cancelApplication(applicationId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()

  const { data: application, error: fetchError } = await supabase
    .from('job_applications')
    .select('id, worker_id, status')
    .eq('id', applicationId)
    .maybeSingle()

  if (fetchError || !application) {
    throw appError('NOT_FOUND')
  }
  if (application.worker_id !== user.id) {
    throw appError('FORBIDDEN')
  }
  if (application.status !== 'pending') {
    throw appError('CONFLICT', 'Lamaran ini sudah tidak berstatus "pending".')
  }

  const { data: updated, error } = await supabase
    .from('job_applications')
    .update({ status: 'cancelled' })
    .eq('id', applicationId)
    .eq('worker_id', user.id)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
  if (!updated || updated.length === 0) {
    throw appError('CONFLICT', 'Lamaran ini sudah tidak berstatus "pending".')
  }
}

export async function rejectApplication(applicationId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()

  const { data: application, error: fetchError } = await supabase
    .from('job_applications')
    .select('id, job_id, status')
    .eq('id', applicationId)
    .maybeSingle()

  if (fetchError || !application) {
    throw appError('NOT_FOUND')
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id, status')
    .eq('id', application.job_id)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }
  if (job.status !== 'open') {
    throw appError('CONFLICT', 'Pekerjaan ini sudah tidak menerima lamaran.')
  }
  if (application.status !== 'pending') {
    throw appError('CONFLICT', 'Lamaran ini sudah ditinjau sebelumnya.')
  }

  const { data: updated, error } = await supabase
    .from('job_applications')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
  if (!updated || updated.length === 0) {
    throw appError('CONFLICT', 'Lamaran ini sudah ditinjau sebelumnya.')
  }
}

export interface ApplicantSummary {
  id: string
  workerId: string
  workerName: string
  status: string
  message: string | null
  appliedAt: string
}

async function loadProfileNames(
  supabase: ServiceClient,
  workerIds: string[]
): Promise<Map<string, string>> {
  if (workerIds.length === 0) {
    return new Map()
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', workerIds)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))
}

export async function getApplicationsForJob(jobId: string): Promise<ApplicantSummary[]> {
  const user = await requireRole('employer')
  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }

  const { data: applications, error } = await supabase
    .from('job_applications')
    .select('id, worker_id, status, message, applied_at')
    .eq('job_id', jobId)
    .order('applied_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = applications ?? []

  const statusOrder: Record<string, number> = { accepted: 0, pending: 1, rejected: 2, cancelled: 2 }
  rows.sort(
    (a, b) =>
      (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3) ||
      new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime()
  )

  const nameById = await loadProfileNames(
    supabase,
    rows.map((row) => row.worker_id)
  )

  return rows.map((row) => ({
    id: row.id,
    workerId: row.worker_id,
    workerName: nameById.get(row.worker_id) ?? 'Tidak diketahui',
    status: row.status,
    message: row.message,
    appliedAt: row.applied_at,
  }))
}

export interface MyApplicationSummary {
  id: string
  jobId: string
  jobTitle: string
  status: string
  appliedAt: string
}

async function loadJobTitles(supabase: ServiceClient, jobIds: string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) {
    return new Map()
  }

  const { data: jobs, error } = await supabase.from('jobs').select('id, title').in('id', jobIds)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return new Map((jobs ?? []).map((job) => [job.id, job.title]))
}

export async function getMyApplications(): Promise<MyApplicationSummary[]> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()
  const { data: applications, error } = await supabase
    .from('job_applications')
    .select('id, job_id, status, applied_at')
    .eq('worker_id', user.id)
    .order('applied_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = applications ?? []
  const titleById = await loadJobTitles(
    supabase,
    rows.map((row) => row.job_id)
  )

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    jobTitle: titleById.get(row.job_id) ?? 'Pekerjaan tidak diketahui',
    status: row.status,
    appliedAt: row.applied_at,
  }))
}

export async function getMyApplicationForJob(jobId: string): Promise<MyApplicationSummary | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const supabase = createServiceClient()
  const { data: application, error } = await supabase
    .from('job_applications')
    .select('id, job_id, status, applied_at')
    .eq('worker_id', user.id)
    .eq('job_id', jobId)
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !application) {
    return null
  }

  const { data: job } = await supabase.from('jobs').select('title').eq('id', jobId).maybeSingle()

  return {
    id: application.id,
    jobId: application.job_id,
    jobTitle: job?.title ?? 'Pekerjaan tidak diketahui',
    status: application.status,
    appliedAt: application.applied_at,
  }
}

function mapSelectWorkerError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT: job not open')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah tidak berstatus "open".')
  }
  if (message.includes('CONFLICT: application not pending')) {
    return appError('CONFLICT', 'Lamaran ini sudah ditinjau sebelumnya.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function selectWorker(jobId: string, applicationId: string): Promise<void> {
  const user = await requireRole('employer')

  const serviceClient = createServiceClient()
  const { data: job, error: jobError } = await serviceClient
    .from('jobs')
    .select('id, employer_id')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }

  // select_job_worker is SECURITY DEFINER and re-derives auth.uid() itself
  // to enforce ownership — it must be called with the caller's real
  // session, never the service-role client (see Global Constraints).
  const authClient = await createClient()
  const { error } = await authClient.rpc('select_job_worker', {
    p_job_id: jobId,
    p_application_id: applicationId,
  })

  if (error) {
    throw mapSelectWorkerError(error.message)
  }
}
