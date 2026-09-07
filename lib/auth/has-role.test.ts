import { describe, expect, it } from 'vitest'
import { hasRole } from './has-role'

describe('hasRole', () => {
  it('returns true when the role is present', () => {
    expect(hasRole([{ role: 'worker' }, { role: 'employer' }], 'employer')).toBe(true)
  })

  it('returns false when the role is absent', () => {
    expect(hasRole([{ role: 'worker' }], 'admin')).toBe(false)
  })

  it('returns false for an empty role list', () => {
    expect(hasRole([], 'worker')).toBe(false)
  })
})
