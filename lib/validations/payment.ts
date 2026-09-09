import { z } from 'zod'

export const SubmitPaymentProofSchema = z.object({
  transferDate: z.coerce
    .date({ error: 'Tanggal transfer tidak valid.' })
    .refine(
      (d) =>
        d.toISOString().slice(0, 10) <=
        new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }),
      { error: 'Tanggal transfer tidak boleh di masa depan.' }
    ),
})

export type SubmitPaymentProofInput = z.infer<typeof SubmitPaymentProofSchema>

export type PaymentProofFormState =
  | {
      errors?: {
        transferDate?: string[]
        file?: string[]
      }
      message?: string
    }
  | undefined
