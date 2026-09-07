import { z } from 'zod'

export const RegisterSchema = z
  .object({
    fullName: z.string().trim().min(2, { error: 'Nama minimal 2 karakter.' }),
    email: z.string().trim().pipe(z.email({ error: 'Masukkan alamat email yang valid.' })),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{7,14}$/, {
        error: 'Masukkan nomor telepon yang valid (8-15 digit).',
      }),
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
  email: z.string().trim().pipe(z.email({ error: 'Masukkan alamat email yang valid.' })),
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
