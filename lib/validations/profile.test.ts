import { describe, expect, it } from 'vitest'
import { UpdateProfileSchema } from './profile'

describe('UpdateProfileSchema', () => {
  it('accepts valid input with an address', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: '081234567890',
        address: 'Jl. Merdeka No. 1',
      }).success
    ).toBe(true)
  })

  it('accepts an empty address', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: '081234567890',
        address: '',
      }).success
    ).toBe(true)
  })

  it('rejects a name that is too short', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'B',
        phone: '081234567890',
        address: '',
      }).success
    ).toBe(false)
  })

  it('rejects an invalid phone number', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: 'abc',
        address: '',
      }).success
    ).toBe(false)
  })

  it('rejects an all-whitespace phone number', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: '        ',
        address: '',
      }).success
    ).toBe(false)
  })

  it('trims a padded full name and accepts it when the trimmed length meets the minimum', () => {
    const result = UpdateProfileSchema.safeParse({
      fullName: '  Budi  ',
      phone: '081234567890',
      address: '',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.fullName).toBe('Budi')
    }
  })

  it('rejects a name that is only whitespace padding around a single character', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: '  a  ',
        phone: '081234567890',
        address: '',
      }).success
    ).toBe(false)
  })
})
