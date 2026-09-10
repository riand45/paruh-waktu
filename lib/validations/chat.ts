import { z } from 'zod'

export const MessageBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { error: 'Pesan tidak boleh kosong.' })
    .max(2000, { error: 'Pesan maksimal 2000 karakter.' }),
})

export type MessageBodyInput = z.infer<typeof MessageBodySchema>
