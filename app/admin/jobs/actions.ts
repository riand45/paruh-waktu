'use server'

import { revalidatePath } from 'next/cache'
import { cancelJob } from '@/lib/services/admin-jobs'
import { cancelJobAndRefund } from '@/lib/services/refunds'
import { toSafeErrorMessage } from '@/lib/errors'

export async function cancelJobAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJob(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/jobs')
  revalidatePath(`/admin/jobs/${jobId}`)
  return { success: true }
}

export async function cancelJobAndRefundAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJobAndRefund(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/jobs')
  revalidatePath(`/admin/jobs/${jobId}`)
  revalidatePath('/admin/payments')
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}
