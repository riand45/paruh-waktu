import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

function mapCancelJobAndRefundError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND', 'Pembayaran untuk pekerjaan ini tidak ditemukan.')
  }
  if (message.includes('payment not verified')) {
    return appError('CONFLICT', 'Pembayaran ini belum terverifikasi.')
  }
  if (message.includes('already cancelled or completed')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah dibatalkan atau selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function cancelJobAndRefund(jobId: string, reason: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('cancel_job_and_refund', {
    p_job_id: jobId,
    p_reason: reason,
  })

  if (error) {
    throw mapCancelJobAndRefundError(error.message)
  }
}

function mapMarkRefundPaidError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Refund ini belum siap untuk ditandai selesai.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function markRefundPaid(paymentId: string, file: File): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()
  const path = `${paymentId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('refund-proofs')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti transfer refund.')
  }

  const { error } = await supabase.rpc('mark_refund_paid', {
    p_payment_id: paymentId,
    p_transfer_proof_path: path,
  })

  if (error) {
    await supabase.storage.from('refund-proofs').remove([path])
    throw mapMarkRefundPaidError(error.message)
  }
}
