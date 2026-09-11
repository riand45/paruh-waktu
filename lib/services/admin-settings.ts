import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import type { PlatformSettingsInput } from '@/lib/validations/platform-settings'
import type { Json } from '@/lib/supabase/database.types'

export async function getAllPlatformSettings(): Promise<PlatformSettingsInput> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data, error } = await supabase.from('platform_settings').select('key, value')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const valueByKey = new Map((data ?? []).map((row) => [row.key, row.value]))

  const bankAccount = (valueByKey.get('admin_bank_account') ?? {}) as {
    bank_name?: string
    account_number?: string
    account_holder_name?: string
  }

  return {
    platformFeePercentage: Number(valueByKey.get('platform_fee_percentage') ?? 0),
    platformFeePayer: (valueByKey.get('platform_fee_payer') ?? 'employer') as 'employer' | 'worker' | 'split',
    defaultJobRadiusKm: Number(valueByKey.get('default_job_radius_km') ?? 10),
    maxUploadSizeMb: Number(valueByKey.get('max_upload_size_mb') ?? 5),
    allowedFileTypes: (valueByKey.get('allowed_file_types') ?? []) as string[],
    bankName: bankAccount.bank_name ?? '',
    bankAccountNumber: bankAccount.account_number ?? '',
    bankAccountHolderName: bankAccount.account_holder_name ?? '',
  }
}

function mapUpdateSettingError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  return appError('INTERNAL_ERROR')
}

export async function updatePlatformSettings(input: PlatformSettingsInput): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const updates: { key: string; value: Json }[] = [
    { key: 'platform_fee_percentage', value: input.platformFeePercentage },
    { key: 'platform_fee_payer', value: input.platformFeePayer },
    { key: 'default_job_radius_km', value: input.defaultJobRadiusKm },
    { key: 'max_upload_size_mb', value: input.maxUploadSizeMb },
    { key: 'allowed_file_types', value: input.allowedFileTypes },
    {
      key: 'admin_bank_account',
      value: {
        bank_name: input.bankName,
        account_number: input.bankAccountNumber,
        account_holder_name: input.bankAccountHolderName,
      },
    },
  ]

  for (const update of updates) {
    const { error } = await supabase.rpc('update_platform_setting', {
      p_key: update.key,
      p_value: update.value,
    })
    if (error) {
      throw mapUpdateSettingError(error.message)
    }
  }
}
