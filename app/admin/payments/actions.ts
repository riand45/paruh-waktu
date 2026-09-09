'use server'

import { revalidatePath } from 'next/cache'
import { reviewPayment } from '@/lib/services/payments'
import { toSafeErrorMessage } from '@/lib/errors'

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
