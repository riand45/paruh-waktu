import { describe, expect, it } from 'vitest'
import { MessageBodySchema } from './chat'

describe('MessageBodySchema', () => {
  it('accepts a normal message', () => {
    const result = MessageBodySchema.safeParse({ body: 'Halo, kapan bisa mulai kerja?' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty message', () => {
    const result = MessageBodySchema.safeParse({ body: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a whitespace-only message', () => {
    const result = MessageBodySchema.safeParse({ body: '   ' })
    expect(result.success).toBe(false)
  })

  it('accepts a message exactly 2000 characters long', () => {
    const result = MessageBodySchema.safeParse({ body: 'a'.repeat(2000) })
    expect(result.success).toBe(true)
  })

  it('rejects a message over 2000 characters long', () => {
    const result = MessageBodySchema.safeParse({ body: 'a'.repeat(2001) })
    expect(result.success).toBe(false)
  })

  it('trims leading and trailing whitespace from the message body', () => {
    const result = MessageBodySchema.safeParse({ body: '  hi  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.body).toBe('hi')
    }
  })
})
