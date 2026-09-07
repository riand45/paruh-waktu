import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(2, { error: 'Nama minimal 2 karakter.' }).trim(),
  phone: z
    .string()
    .regex(/^\+?[0-9\s-]{8,15}$/, {
      error: 'Masukkan nomor telepon yang valid (8-15 digit).',
    })
    .trim(),
  address: z
    .string()
    .max(255, { error: 'Alamat maksimal 255 karakter.' })
    .trim()
    .optional()
    .or(z.literal('')),
})

export type UpdateProfileFormState =
  | {
      errors?: {
        fullName?: string[]
        phone?: string[]
        address?: string[]
      }
      message?: string
    }
  | undefined
