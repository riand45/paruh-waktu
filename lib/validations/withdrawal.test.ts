import { describe, expect, it } from 'vitest'
import { RequestWithdrawalSchema } from './withdrawal'

const validInput = {
  amount: '50000',
  bankName: 'Bank Central Asia',
  accountNumber: '1234567890',
  accountHolderName: 'Budi Santoso',
}

describe('RequestWithdrawalSchema', () => {
  it('accepts valid input and coerces amount to a number', () => {
    const result = RequestWithdrawalSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.amount).toBe(50000)
    }
  })

  it('rejects a zero amount', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, amount: '0' })
    expect(result.success).toBe(false)
  })

  it('rejects a negative amount', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, amount: '-1000' })
    expect(result.success).toBe(false)
  })

  it('rejects an amount with 3 decimal places', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, amount: '100000.005' })
    expect(result.success).toBe(false)
  })

  it('accepts an amount with exactly 2 decimal places', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, amount: '100000.50' })
    expect(result.success).toBe(true)
  })

  it('rejects a blank bank name', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, bankName: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank account number', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, accountNumber: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank account holder name', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, accountHolderName: '' })
    expect(result.success).toBe(false)
  })
})
