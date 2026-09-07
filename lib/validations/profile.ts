import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  fullName: z.string().trim().min(2, { error: 'Nama minimal 2 karakter.' }),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s-]{7,14}$/, {
      error: 'Masukkan nomor telepon yang valid (8-15 digit).',
    }),
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
      status?: 'success' | 'error'
      message?: string
    }
  | undefined
