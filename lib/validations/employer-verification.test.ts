import { describe, expect, it } from 'vitest'
import { SubmitEmployerVerificationSchema } from './employer-verification'

describe('SubmitEmployerVerificationSchema', () => {
  const valid = {
    fullNameOnKtp: 'Budi Santoso',
    ktpNumber: '3171234567890001',
  }

  it('accepts valid input', () => {
    expect(SubmitEmployerVerificationSchema.safeParse(valid).success).toBe(true)
  })

  it('trims whitespace before validating the name', () => {
    const result = SubmitEmployerVerificationSchema.safeParse({
      ...valid,
      fullNameOnKtp: '  Budi Santoso  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.fullNameOnKtp).toBe('Budi Santoso')
    }
  })

  it('rejects a name shorter than 2 characters after trimming', () => {
    const result = SubmitEmployerVerificationSchema.safeParse({
      ...valid,
      fullNameOnKtp: '  a  ',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a KTP number that is not exactly 16 digits', () => {
    expect(
      SubmitEmployerVerificationSchema.safeParse({ ...valid, ktpNumber: '12345' }).success
    ).toBe(false)
  })

  it('rejects a KTP number containing non-digit characters', () => {
    expect(
      SubmitEmployerVerificationSchema.safeParse({
        ...valid,
        ktpNumber: '317123456789000a',
      }).success
    ).toBe(false)
  })

  it('rejects a whitespace-only KTP number', () => {
    expect(
      SubmitEmployerVerificationSchema.safeParse({
        ...valid,
        ktpNumber: '                ',
      }).success
    ).toBe(false)
  })
})
