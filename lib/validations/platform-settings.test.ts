import { describe, it, expect } from 'vitest'
import { PlatformSettingsSchema } from './platform-settings'

const validInput = {
  platformFeePercentage: '10',
  platformFeePayer: 'employer',
  defaultJobRadiusKm: '10',
  maxUploadSizeMb: '5',
  allowedFileTypes: 'image/jpeg, image/png, application/pdf',
  bankName: 'Bank Central Asia',
  bankAccountNumber: '1234567890',
  bankAccountHolderName: 'PT Paruh Waktu',
}

describe('PlatformSettingsSchema', () => {
  it('accepts a fully valid input and parses allowedFileTypes into an array', () => {
    const result = PlatformSettingsSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.allowedFileTypes).toEqual(['image/jpeg', 'image/png', 'application/pdf'])
      expect(result.data.platformFeePercentage).toBe(10)
    }
  })

  it('rejects a platformFeePercentage above 100', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, platformFeePercentage: '150' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid platformFeePayer', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, platformFeePayer: 'admin' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive defaultJobRadiusKm', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, defaultJobRadiusKm: '0' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive maxUploadSizeMb', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, maxUploadSizeMb: '-1' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank allowedFileTypes', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, allowedFileTypes: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank bankName', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, bankName: '   ' })
    expect(result.success).toBe(false)
  })
})
