'use server'

import { revalidatePath } from 'next/cache'
import { submitPaymentProof } from '@/lib/services/payments'
import { SubmitPaymentProofSchema, type PaymentProofFormState } from '@/lib/validations/payment'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export async function submitPaymentProofAction(
  paymentId: string,
  jobId: string,
  _prevState: PaymentProofFormState,
  formData: FormData
): Promise<PaymentProofFormState> {
  const validatedFields = SubmitPaymentProofSchema.safeParse({
    transferDate: formData.get('transferDate'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

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
    await submitPaymentProof(paymentId, file, validatedFields.data.transferDate)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/payment`)
  revalidatePath(`/jobs/${jobId}`)
  return undefined
}
