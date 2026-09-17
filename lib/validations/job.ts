import { z } from 'zod'

const COORDINATE_REQUIRED_ERROR = 'Pilih lokasi pada peta.'

// Coordinates arrive from the form as strings. `z.coerce.number()` alone would
// turn an empty string into 0 (`Number('') === 0`), which is inside both valid
// ranges -- so a job could be saved at (0, 0) with no location ever picked and
// no error shown. Reject blank/missing input *before* coercing.
//
// The number branch of the union is deliberate: `createJob()`/`updateJob()` in
// lib/services/jobs.ts re-validate their already-parsed input, so this schema
// must stay idempotent (parsing its own output must succeed).
function coordinateSchema(limit: number, rangeError: string) {
  return z
    .union([z.string().trim().min(1, { error: COORDINATE_REQUIRED_ERROR }), z.number()], {
      error: COORDINATE_REQUIRED_ERROR,
    })
    .pipe(
      // The explicit type argument narrows the coerced schema's *input* type
      // from `unknown` to the union's output type so `.pipe()` type-checks.
      z.coerce
        .number<string | number>({ error: rangeError })
        .min(-limit, { error: rangeError })
        .max(limit, { error: rangeError })
    )
}

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
  latitude: coordinateSchema(90, 'Latitude tidak valid.'),
  longitude: coordinateSchema(180, 'Longitude tidak valid.'),
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
