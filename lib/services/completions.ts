import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface JobEvidence {
  id: string
  filePath: string
  fileType: string
  uploadedAt: string
}

interface JobEvidenceRow {
  id: string
  file_path: string
  file_type: string
  created_at: string
}

function mapJobEvidenceRow(row: JobEvidenceRow): JobEvidence {
  return {
    id: row.id,
    filePath: row.file_path,
    fileType: row.file_type,
    uploadedAt: row.created_at,
  }
}

function mapStartWorkError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini belum siap untuk dikerjakan.')
  }
  return appError('INTERNAL_ERROR')
}

export async function startWork(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('start_work', { p_job_id: jobId })

  if (error) {
    throw mapStartWorkError(error.message)
  }
}

function mapRecordJobEvidenceError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini tidak dapat menerima bukti baru.')
  }
  return appError('INTERNAL_ERROR')
}

export async function recordJobEvidence(jobId: string, file: File): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const path = `${jobId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('job-evidences')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti pekerjaan.')
  }

  const { data, error } = await supabase.rpc('record_job_evidence', {
    p_job_id: jobId,
    p_file_path: path,
    p_file_type: file.type,
    p_file_size_bytes: file.size,
  })

  if (error) {
    await supabase.storage.from('job-evidences').remove([path])
    throw mapRecordJobEvidenceError(error.message)
  }

  return { id: data as string }
}

function mapSubmitJobCompletionError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('at least one evidence file required')) {
    return appError('VALIDATION_ERROR', 'Unggah minimal satu bukti pekerjaan sebelum mengajukan selesai.')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini belum siap untuk diajukan selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function submitJobCompletion(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_job_completion', { p_job_id: jobId })

  if (error) {
    throw mapSubmitJobCompletionError(error.message)
  }
}

function mapConfirmJobCompletionError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini tidak dapat dikonfirmasi selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function confirmJobCompletion(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_job_completion', { p_job_id: jobId })

  if (error) {
    throw mapConfirmJobCompletionError(error.message)
  }
}

export async function getJobEvidences(jobId: string): Promise<JobEvidence[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('job_evidences')
    .select('id, file_path, file_type, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map(mapJobEvidenceRow)
}
