'use server'

import { revalidatePath } from 'next/cache'
import { reviewPayment } from '@/lib/services/payments'
import { cancelJobAndRefund, markRefundPaid } from '@/lib/services/refunds'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

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
  const limits = await getEffectiveUploadLimits('refundProof')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
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
