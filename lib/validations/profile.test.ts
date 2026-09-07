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
})
