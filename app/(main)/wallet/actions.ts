'use server'

import { revalidatePath } from 'next/cache'
import { requestWithdrawal } from '@/lib/services/withdrawals'
import { RequestWithdrawalSchema, type RequestWithdrawalFormState } from '@/lib/validations/withdrawal'
import { toSafeErrorMessage } from '@/lib/errors'

export async function requestWithdrawalAction(
  _prevState: RequestWithdrawalFormState,
  formData: FormData
): Promise<RequestWithdrawalFormState> {
  const validatedFields = RequestWithdrawalSchema.safeParse({
    amount: formData.get('amount'),
    bankName: formData.get('bankName'),
    accountNumber: formData.get('accountNumber'),
    accountHolderName: formData.get('accountHolderName'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await requestWithdrawal(
      validatedFields.data.amount,
      validatedFields.data.bankName,
      validatedFields.data.accountNumber,
      validatedFields.data.accountHolderName
    )
  } catch (error) {
    return { status: 'error', message: toSafeErrorMessage(error) }
  }

  revalidatePath('/wallet')
  return { status: 'success', message: 'Permintaan withdrawal berhasil diajukan.' }
}
