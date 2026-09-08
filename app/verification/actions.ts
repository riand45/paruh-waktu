'use server'

import { revalidatePath } from 'next/cache'
import { submitEmployerVerification } from '@/lib/services/employer-verifications'
import {
  SubmitEmployerVerificationSchema,
  type SubmitEmployerVerificationFormState,
} from '@/lib/validations/employer-verification'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

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
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { errors: { file: ['Format file harus JPEG, PNG, atau PDF.'] } }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { errors: { file: ['Ukuran file maksimal 10MB.'] } }
  }

  try {
    await submitEmployerVerification({ ...validatedFields.data, file })
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/verification')
  return { message: 'Pengajuan berhasil dikirim. Menunggu peninjauan Admin.' }
}
