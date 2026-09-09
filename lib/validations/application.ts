import { z } from 'zod'

export const ApplyToJobSchema = z.object({
  message: z
    .string()
    .trim()
    .max(1000, { error: 'Pesan maksimal 1000 karakter.' })
    .optional(),
})

export type ApplyToJobInput = z.infer<typeof ApplyToJobSchema>

export type ApplicationFormState =
  | {
      errors?: {
        message?: string[]
      }
      message?: string
    }
  | undefined
