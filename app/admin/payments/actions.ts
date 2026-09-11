'use server'

import { revalidatePath } from 'next/cache'
import { reviewPayment } from '@/lib/services/payments'
import { cancelJobAndRefund, markRefundPaid } from '@/lib/services/refunds'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export async function cancelJobAndRefundAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJobAndRefund(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}

export type MarkRefundPaidFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function markRefundPaidAction(
  paymentId: string,
  _prevState: MarkRefundPaidFormState,
  formData: FormData
): Promise<MarkRefundPaidFormState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti transfer wajib diunggah.'] } }
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { errors: { file: ['Format file harus JPEG, PNG, atau PDF.'] } }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { errors: { file: ['Ukuran file maksimal 10MB.'] } }
  }

  try {
    await markRefundPaid(paymentId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${paymentId}`)
  return undefined
}

export async function reviewPaymentAction(
  paymentId: string,
  decision: 'verified' | 'rejected',
  rejectionReason?: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await reviewPayment(paymentId, decision, rejectionReason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${paymentId}`)
  return { success: true }
}
