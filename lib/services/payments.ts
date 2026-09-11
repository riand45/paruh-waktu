import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import { SubmitPaymentProofSchema } from '@/lib/validations/payment'

export interface PaymentDetail {
  id: string
  jobId: string
  amount: number
  platformFee: number
  totalAmount: number
  feePayer: string
  status: string
  transferDate: string | null
  rejectionReason: string | null
  refundTransferProofPath: string | null
  refundedAt: string | null
}

interface PaymentRow {
  id: string
  job_id: string
  amount: number
  platform_fee: number
  total_amount: number
  fee_payer: string
  status: string
  transfer_date: string | null
  rejection_reason: string | null
  refund_transfer_proof_path: string | null
  refunded_at: string | null
}

function mapPaymentRow(row: PaymentRow): PaymentDetail {
  return {
    id: row.id,
    jobId: row.job_id,
    amount: row.amount,
    platformFee: row.platform_fee,
    totalAmount: row.total_amount,
    feePayer: row.fee_payer,
    status: row.status,
    transferDate: row.transfer_date,
    rejectionReason: row.rejection_reason,
    refundTransferProofPath: row.refund_transfer_proof_path,
    refundedAt: row.refunded_at,
  }
}

export async function getPaymentForJob(jobId: string): Promise<PaymentDetail | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const supabase = await createClient()

  const { data: job } = await supabase.from('jobs').select('employer_id').eq('id', jobId).maybeSingle()

  if (job && job.employer_id === user.id) {
    const { error } = await supabase.rpc('get_or_create_payment', { p_job_id: jobId })
    if (error) {
      if (error.message.includes('CONFLICT') || error.message.includes('NOT_FOUND')) {
        return null
      }
      throw appError('INTERNAL_ERROR')
    }
  }

  const { data, error } = await supabase
    .from('payments')
    .select('id, job_id, amount, platform_fee, total_amount, fee_payer, status, transfer_date, rejection_reason, refund_transfer_proof_path, refunded_at')
    .eq('job_id', jobId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return mapPaymentRow(data)
}

function mapSubmitProofError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pembayaran ini sudah tidak menerima bukti transfer baru.')
  }
  return appError('INTERNAL_ERROR')
}

export async function submitPaymentProof(
  paymentId: string,
  file: File,
  transferDate: Date
): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }
  const validated = SubmitPaymentProofSchema.parse({ transferDate })

  const supabase = await createClient()
  const path = `${paymentId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('payment-proofs')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti transfer.')
  }

  const { data, error } = await supabase.rpc('submit_payment_proof', {
    p_payment_id: paymentId,
    p_file_path: path,
    p_file_size_bytes: file.size,
    p_transfer_date: validated.transferDate.toISOString().slice(0, 10),
  })

  if (error) {
    await supabase.storage.from('payment-proofs').remove([path])
    throw mapSubmitProofError(error.message)
  }

  return { id: data as string }
}

export interface PendingPaymentSummary {
  id: string
  jobId: string
  jobTitle: string
  employerName: string
  totalAmount: number
  status: string
}

export async function getPendingPayments(): Promise<PendingPaymentSummary[]> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: payments, error } = await supabase
    .from('payments')
    .select('id, job_id, employer_id, total_amount, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = payments ?? []
  const statusOrder: Record<string, number> = {
    waiting_verification: 0,
    waiting_payment: 1,
    rejected: 2,
    verified: 3,
  }
  rows.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4))

  if (rows.length === 0) {
    return []
  }

  const jobIds = rows.map((row) => row.job_id)
  const employerIds = rows.map((row) => row.employer_id)

  const { data: jobs, error: jobsError } = await supabase.from('jobs').select('id, title').in('id', jobIds)
  if (jobsError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', employerIds)
  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const titleById = new Map((jobs ?? []).map((job) => [job.id, job.title]))
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    jobTitle: titleById.get(row.job_id) ?? 'Pekerjaan tidak diketahui',
    employerName: nameById.get(row.employer_id) ?? 'Tidak diketahui',
    totalAmount: row.total_amount,
    status: row.status,
  }))
}

export interface AdminPaymentDetail extends PaymentDetail {
  jobTitle: string
  jobStatus: string
  employerName: string
  proofs: { id: string; filePath: string; uploadedAt: string }[]
}

export async function getPaymentDetailForAdmin(paymentId: string): Promise<AdminPaymentDetail | null> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: payment, error } = await supabase
    .from('payments')
    .select(
      'id, job_id, employer_id, amount, platform_fee, total_amount, fee_payer, status, transfer_date, rejection_reason, refund_transfer_proof_path, refunded_at'
    )
    .eq('id', paymentId)
    .maybeSingle()

  if (error || !payment) {
    return null
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('title, status')
    .eq('id', payment.job_id)
    .maybeSingle()
  if (jobError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', payment.employer_id)
    .maybeSingle()
  if (profileError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: proofs, error: proofsError } = await supabase
    .from('payment_proofs')
    .select('id, file_path, created_at')
    .eq('payment_id', paymentId)
    .order('created_at', { ascending: false })

  if (proofsError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    ...mapPaymentRow(payment),
    jobTitle: job?.title ?? 'Pekerjaan tidak diketahui',
    jobStatus: job?.status ?? 'unknown',
    employerName: profile?.full_name ?? 'Tidak diketahui',
    proofs: (proofs ?? []).map((proof) => ({
      id: proof.id,
      filePath: proof.file_path,
      uploadedAt: proof.created_at,
    })),
  }
}

function mapReviewPaymentError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pembayaran ini sudah ditinjau sebelumnya.')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('rejection_reason required')) {
    return appError('VALIDATION_ERROR', 'Alasan penolakan wajib diisi.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function reviewPayment(
  paymentId: string,
  decision: 'verified' | 'rejected',
  rejectionReason?: string
): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('review_payment', {
    p_payment_id: paymentId,
    p_decision: decision,
    p_rejection_reason: rejectionReason,
  })

  if (error) {
    throw mapReviewPaymentError(error.message)
  }
}
