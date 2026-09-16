'use server'

import { revalidatePath } from 'next/cache'
import { processWithdrawal, rejectWithdrawal, markWithdrawalPaid } from '@/lib/services/withdrawals'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export async function processWithdrawalAction(
  withdrawalId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await processWithdrawal(withdrawalId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/withdrawals')
  revalidatePath(`/admin/withdrawals/${withdrawalId}`)
  return { success: true }
}

export async function rejectWithdrawalAction(
  withdrawalId: string,
  rejectionReason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await rejectWithdrawal(withdrawalId, rejectionReason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/withdrawals')
  revalidatePath(`/admin/withdrawals/${withdrawalId}`)
  revalidatePath('/wallet')
  return { success: true }
}

export type MarkWithdrawalPaidFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function markWithdrawalPaidAction(
  withdrawalId: string,
  _prevState: MarkWithdrawalPaidFormState,
  formData: FormData
): Promise<MarkWithdrawalPaidFormState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti transfer wajib diunggah.'] } }
  }
  const limits = await getEffectiveUploadLimits('withdrawalProof')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
  }

  try {
    await markWithdrawalPaid(withdrawalId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/withdrawals')
  revalidatePath(`/admin/withdrawals/${withdrawalId}`)
  revalidatePath('/wallet')
  return undefined
}
