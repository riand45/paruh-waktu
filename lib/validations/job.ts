import { z } from 'zod'

export const CreateJobSchema = z.object({
  title: z.string().trim().min(5, { error: 'Judul minimal 5 karakter.' }),
  categoryId: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
      error: 'Kategori tidak valid.',
    }),
  description: z.string().trim().min(20, { error: 'Deskripsi minimal 20 karakter.' }),
  address: z.string().trim().min(5, { error: 'Alamat minimal 5 karakter.' }),
  latitude: z.coerce
    .number()
    .min(-90, { error: 'Latitude tidak valid.' })
    .max(90, { error: 'Latitude tidak valid.' }),
  longitude: z.coerce
    .number()
    .min(-180, { error: 'Longitude tidak valid.' })
    .max(180, { error: 'Longitude tidak valid.' }),
  paymentAmount: z.coerce.number().positive({ error: 'Nominal pembayaran harus lebih dari 0.' }),
  durationMinutes: z.coerce
    .number()
    .int({ error: 'Durasi harus bilangan bulat.' })
    .positive({ error: 'Durasi harus lebih dari 0.' }),
  deadline: z.coerce
    .date({ error: 'Deadline tidak valid.' })
    .refine((d) => d.getTime() > Date.now(), { error: 'Deadline harus di masa depan.' }),
})

export type CreateJobInput = z.infer<typeof CreateJobSchema>

export type JobFormState =
  | {
      errors?: {
        title?: string[]
        categoryId?: string[]
        description?: string[]
        address?: string[]
        latitude?: string[]
        longitude?: string[]
        paymentAmount?: string[]
        durationMinutes?: string[]
        deadline?: string[]
      }
      message?: string
    }
  | undefined
