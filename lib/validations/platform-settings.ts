import { z } from 'zod'

export const PlatformSettingsSchema = z.object({
  platformFeePercentage: z.coerce.number().min(0).max(100),
  platformFeePayer: z.enum(['employer', 'worker', 'split']),
  defaultJobRadiusKm: z.coerce.number().positive(),
  maxUploadSizeMb: z.coerce.number().positive(),
  allowedFileTypes: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.string()).min(1, { error: 'Minimal satu tipe file harus diisi.' })),
  bankName: z.string().trim().min(1, { error: 'Nama bank wajib diisi.' }),
  bankAccountNumber: z.string().trim().min(1, { error: 'Nomor rekening wajib diisi.' }),
  bankAccountHolderName: z.string().trim().min(1, { error: 'Nama pemilik rekening wajib diisi.' }),
})

export type PlatformSettingsInput = z.infer<typeof PlatformSettingsSchema>
