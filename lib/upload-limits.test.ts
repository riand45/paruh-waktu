import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeEffectiveLimits, validateUploadedFile, UPLOAD_CEILINGS } from './upload-limits'

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'test-file', { type })
}

describe('computeEffectiveLimits', () => {
  it('uses the platform max size when it is smaller than the context ceiling', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.jobEvidence, 5, ['image/jpeg'])
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('uses the context ceiling when the platform max size is larger', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.avatar, 50, ['image/jpeg'])
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('uses the same value when the platform max size exactly equals the context ceiling', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.avatar, 5, ['image/jpeg'])
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('intersects allowed types, dropping types the platform setting does not include', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.jobEvidence, 20, ['image/jpeg', 'image/png'])
    expect(result.allowedTypes).toEqual(['image/jpeg', 'image/png'])
  })

  it('produces an empty allowed-types list when the platform setting has no overlap at all', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.avatar, 20, ['application/pdf'])
    expect(result.allowedTypes).toEqual([])
  })
})

describe('validateUploadedFile', () => {
  const limits = { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png'] }

  it('accepts a file within the type and size limits', () => {
    const file = makeFile('image/jpeg', 1024)
    expect(validateUploadedFile(file, limits)).toBeNull()
  })

  it('rejects a disallowed type and names the effective allowed types in the message', () => {
    const file = makeFile('application/pdf', 1024)
    expect(validateUploadedFile(file, limits)).toBe('Format file harus JPEG, PNG.')
  })

  it('rejects an oversized file and states the effective MB ceiling in the message', () => {
    const file = makeFile('image/jpeg', 11 * 1024 * 1024)
    expect(validateUploadedFile(file, limits)).toBe('Ukuran file maksimal 10MB.')
  })

  it('falls back to a no-types-allowed message when the effective allowed types list is empty', () => {
    const file = makeFile('image/jpeg', 1024)
    expect(validateUploadedFile(file, { maxSizeBytes: limits.maxSizeBytes, allowedTypes: [] })).toBe(
      'Tidak ada format file yang diizinkan Admin untuk unggahan ini.'
    )
  })
})
