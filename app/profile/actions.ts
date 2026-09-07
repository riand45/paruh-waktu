'use server'

import { revalidatePath } from 'next/cache'
import { updateOwnProfile } from '@/lib/services/profiles'
import { UpdateProfileSchema, type UpdateProfileFormState } from '@/lib/validations/profile'
import { toSafeErrorMessage } from '@/lib/errors'

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
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/profile')
  return { message: 'Profil berhasil diperbarui.' }
}
