import { z } from 'zod'

export const RegisterSchema = z
  .object({
    fullName: z.string().min(2, { error: 'Nama minimal 2 karakter.' }).trim(),
    email: z.email({ error: 'Masukkan alamat email yang valid.' }).trim(),
    phone: z
      .string()
      .regex(/^\+?[0-9\s-]{8,15}$/, {
        error: 'Masukkan nomor telepon yang valid (8-15 digit).',
      })
      .trim(),
    password: z
      .string()
      .min(8, { error: 'Password minimal 8 karakter.' })
      .regex(/[a-zA-Z]/, { error: 'Password harus mengandung huruf.' })
      .regex(/[0-9]/, { error: 'Password harus mengandung angka.' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Konfirmasi password tidak cocok.',
    path: ['confirmPassword'],
  })

export type RegisterFormState =
  | {
      errors?: {
        fullName?: string[]
        email?: string[]
        phone?: string[]
        password?: string[]
        confirmPassword?: string[]
      }
      message?: string
    }
  | undefined

export const LoginSchema = z.object({
  email: z.email({ error: 'Masukkan alamat email yang valid.' }).trim(),
  password: z.string().min(1, { error: 'Password wajib diisi.' }),
})

export type LoginFormState =
  | {
      errors?: {
        email?: string[]
        password?: string[]
      }
      message?: string
    }
  | undefined
