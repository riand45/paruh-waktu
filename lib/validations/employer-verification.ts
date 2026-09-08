import { z } from 'zod'

export const SubmitEmployerVerificationSchema = z.object({
  fullNameOnKtp: z
    .string()
    .trim()
    .min(2, { error: 'Nama sesuai KTP minimal 2 karakter.' }),
  ktpNumber: z
    .string()
    .trim()
    .regex(/^\d{16}$/, { error: 'Nomor KTP harus 16 digit angka.' }),
})

export type SubmitEmployerVerificationFormState =
  | {
      errors?: {
        fullNameOnKtp?: string[]
        ktpNumber?: string[]
        file?: string[]
      }
      message?: string
    }
  | undefined
