import { describe, expect, it } from 'vitest'
import { LoginSchema, RegisterSchema } from './auth'

describe('RegisterSchema', () => {
  const valid = {
    fullName: 'Budi Santoso',
    email: 'budi@example.com',
    phone: '081234567890',
    password: 'password1',
    confirmPassword: 'password1',
  }

  it('accepts valid input', () => {
    expect(RegisterSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a password without a number', () => {
    const result = RegisterSchema.safeParse({
      ...valid,
      password: 'passwordonly',
      confirmPassword: 'passwordonly',
    })
    expect(result.success).toBe(false)
  })

  it('rejects mismatched confirmPassword', () => {
    const result = RegisterSchema.safeParse({
      ...valid,
      confirmPassword: 'different1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = RegisterSchema.safeParse({ ...valid, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects a phone number that is too short', () => {
    const result = RegisterSchema.safeParse({ ...valid, phone: '123' })
    expect(result.success).toBe(false)
  })
})

describe('LoginSchema', () => {
  it('accepts valid input', () => {
    expect(
      LoginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success
    ).toBe(true)
  })

  it('rejects an empty password', () => {
    expect(
      LoginSchema.safeParse({ email: 'a@b.com', password: '' }).success
    ).toBe(false)
  })

  it('rejects an invalid email', () => {
    expect(
      LoginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success
    ).toBe(false)
  })
})
