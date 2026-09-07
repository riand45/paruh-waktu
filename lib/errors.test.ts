import { describe, expect, it, vi } from 'vitest'
import { AppError, appError, toSafeErrorMessage } from './errors'

describe('toSafeErrorMessage', () => {
  it('returns the public message for an AppError', () => {
    const error = appError('NOT_FOUND', 'Pekerjaan tidak ditemukan.')
    expect(toSafeErrorMessage(error)).toBe('Pekerjaan tidak ditemukan.')
  })

  it('returns a friendly message for a bare UNAUTHENTICATED error', () => {
    expect(toSafeErrorMessage(new Error('UNAUTHENTICATED'))).toMatch(/masuk/)
  })

  it('never leaks a raw unknown error message and logs it instead', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const message = toSafeErrorMessage(new Error('relation "foo" does not exist'))
    expect(message).not.toMatch(/relation/)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('constructs AppError with the default message for its code', () => {
    const error = new AppError('FORBIDDEN', 'custom')
    expect(error.code).toBe('FORBIDDEN')
    expect(error.publicMessage).toBe('custom')
  })

  it('falls back to the default message for a code when none is given', () => {
    const error = appError('NOT_FOUND')
    expect(error.publicMessage).toBe('Data yang Anda cari tidak ditemukan.')
  })
})
