'use server'

import { revalidatePath } from 'next/cache'
import { submitEmployerVerification } from '@/lib/services/employer-verifications'
import {
  SubmitEmployerVerificationSchema,
  type SubmitEmployerVerificationFormState,
} from '@/lib/validations/employer-verification'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export async function submitEmployerVerificationAction(
  _prevState: SubmitEmployerVerificationFormState,
  formData: FormData
): Promise<SubmitEmployerVerificationFormState> {
  const validatedFields = SubmitEmployerVerificationSchema.safeParse({
    fullNameOnKtp: formData.get('fullNameOnKtp'),
    ktpNumber: formData.get('ktpNumber'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  const file = formData.get('ktpDocument')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Dokumen KTP wajib diunggah.'] } }
  }
  const limits = await getEffectiveUploadLimits('ktp')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
  }

  try {
    await submitEmployerVerification({ ...validatedFields.data, file })
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/verification')
  return { message: 'Pengajuan berhasil dikirim. Menunggu peninjauan Admin.' }
}
