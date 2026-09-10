import { z } from 'zod'

export const RequestWithdrawalSchema = z.object({
  amount: z.coerce
    .number({ error: 'Jumlah tidak valid.' })
    .positive({ error: 'Jumlah harus lebih dari 0.' })
    .multipleOf(0.01, { error: 'Jumlah maksimal 2 angka desimal.' }),
  bankName: z.string().trim().min(1, { error: 'Nama bank wajib diisi.' }),
  accountNumber: z.string().trim().min(1, { error: 'Nomor rekening wajib diisi.' }),
  accountHolderName: z.string().trim().min(1, { error: 'Nama pemilik rekening wajib diisi.' }),
})

export type RequestWithdrawalFormState =
  | {
      errors?: {
        amount?: string[]
        bankName?: string[]
        accountNumber?: string[]
        accountHolderName?: string[]
      }
      status?: 'success' | 'error'
      message?: string
    }
  | undefined
