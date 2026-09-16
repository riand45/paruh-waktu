'use server'

import { revalidatePath } from 'next/cache'
import { submitPaymentProof } from '@/lib/services/payments'
import { SubmitPaymentProofSchema, type PaymentProofFormState } from '@/lib/validations/payment'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

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
  const limits = await getEffectiveUploadLimits('paymentProof')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
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
