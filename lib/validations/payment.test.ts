import { describe, expect, it } from 'vitest'
import { SubmitPaymentProofSchema } from './payment'

describe('SubmitPaymentProofSchema', () => {
  it('accepts a valid past transfer date', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: yesterday })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.transferDate).toBeInstanceOf(Date)
    }
  })

  it('accepts today as the transfer date', () => {
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: new Date().toISOString() })
    expect(result.success).toBe(true)
  })

  it('rejects a future transfer date', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: tomorrow })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid date string', () => {
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: 'not-a-date' })
    expect(result.success).toBe(false)
  })
})
