import { describe, expect, it } from 'vitest'
import { SubmitPaymentProofSchema } from './payment'

function toDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
}

describe('SubmitPaymentProofSchema', () => {
  it('accepts a valid past transfer date', () => {
    const yesterday = toDateString(new Date(Date.now() - 24 * 60 * 60 * 1000))
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: yesterday })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.transferDate).toBeInstanceOf(Date)
    }
  })

  it('accepts today as the transfer date, as a bare date string', () => {
    const today = toDateString(new Date())
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: today })
    expect(result.success).toBe(true)
  })

  it('rejects a future transfer date', () => {
    const tomorrow = toDateString(new Date(Date.now() + 24 * 60 * 60 * 1000))
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: tomorrow })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid date string', () => {
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: 'not-a-date' })
    expect(result.success).toBe(false)
  })
})
