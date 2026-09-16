'use server'

import { revalidatePath } from 'next/cache'
import { updateOwnAvatar, updateOwnProfile } from '@/lib/services/profiles'
import { UpdateProfileSchema, type UpdateProfileFormState } from '@/lib/validations/profile'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export async function updateProfileAction(
  _prevState: UpdateProfileFormState,
  formData: FormData
): Promise<UpdateProfileFormState> {
  const validatedFields = UpdateProfileSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    address: formData.get('address'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await updateOwnProfile(validatedFields.data)
  } catch (error) {
    return { status: 'error', message: toSafeErrorMessage(error) }
  }

  revalidatePath('/profile')
  return { status: 'success', message: 'Profil berhasil diperbarui.' }
}

export async function updateAvatarAction(
  formData: FormData
): Promise<{ success: true; avatarUrl: string } | { success: false; message: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: 'Foto wajib diunggah.' }
  }

  const limits = await getEffectiveUploadLimits('avatar')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { success: false, message: validationError }
  }

  try {
    const avatarUrl = await updateOwnAvatar(file)
    revalidatePath('/profile')
    return { success: true, avatarUrl }
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }
}
