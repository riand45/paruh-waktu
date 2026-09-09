import { describe, expect, it } from 'vitest'
import { ApplyToJobSchema } from './application'

describe('ApplyToJobSchema', () => {
  it('accepts an empty input with no message', () => {
    const result = ApplyToJobSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toBeUndefined()
    }
  })

  it('accepts a valid message and trims whitespace', () => {
    const result = ApplyToJobSchema.safeParse({ message: '  Saya berpengalaman.  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toBe('Saya berpengalaman.')
    }
  })

  it('accepts a message exactly at the 1000-character limit', () => {
    const result = ApplyToJobSchema.safeParse({ message: 'a'.repeat(1000) })
    expect(result.success).toBe(true)
  })

  it('rejects a message longer than 1000 characters', () => {
    const result = ApplyToJobSchema.safeParse({ message: 'a'.repeat(1001) })
    expect(result.success).toBe(false)
  })
})
