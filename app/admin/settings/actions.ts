'use server'

import { revalidatePath } from 'next/cache'
import { updatePlatformSettings } from '@/lib/services/admin-settings'
import { PlatformSettingsSchema } from '@/lib/validations/platform-settings'
import { toSafeErrorMessage } from '@/lib/errors'

export type UpdateSettingsFormState =
  | {
      errors?: Record<string, string[]>
      message?: string
      success?: true
    }
  | undefined

export async function updateSettingsAction(
  _prevState: UpdateSettingsFormState,
  formData: FormData
): Promise<UpdateSettingsFormState> {
  const parsed = PlatformSettingsSchema.safeParse({
    platformFeePercentage: formData.get('platformFeePercentage'),
    platformFeePayer: formData.get('platformFeePayer'),
    defaultJobRadiusKm: formData.get('defaultJobRadiusKm'),
    maxUploadSizeMb: formData.get('maxUploadSizeMb'),
    allowedFileTypes: formData.get('allowedFileTypes'),
    bankName: formData.get('bankName'),
    bankAccountNumber: formData.get('bankAccountNumber'),
    bankAccountHolderName: formData.get('bankAccountHolderName'),
  })

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  try {
    await updatePlatformSettings(parsed.data)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/settings')
  return { success: true }
}
