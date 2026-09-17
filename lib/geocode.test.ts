import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GeocodeQuerySchema,
  ReverseGeocodeQuerySchema,
  parseNominatimSearchResult,
  parseNominatimReverseResult,
} from './geocode'

describe('GeocodeQuerySchema', () => {
  it('accepts a non-empty query', () => {
    expect(GeocodeQuerySchema.safeParse({ q: 'Jakarta' }).success).toBe(true)
  })

  it('rejects an empty query', () => {
    expect(GeocodeQuerySchema.safeParse({ q: '' }).success).toBe(false)
  })

  it('rejects a whitespace-only query', () => {
    expect(GeocodeQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
  })
})

describe('ReverseGeocodeQuerySchema', () => {
  it('accepts valid coordinates as strings (query params are always strings)', () => {
    expect(ReverseGeocodeQuerySchema.safeParse({ lat: '-6.2088', lon: '106.8456' }).success).toBe(true)
  })

  it('rejects an out-of-range latitude', () => {
    expect(ReverseGeocodeQuerySchema.safeParse({ lat: '95', lon: '106.8456' }).success).toBe(false)
  })

  it('rejects a non-numeric longitude', () => {
    expect(ReverseGeocodeQuerySchema.safeParse({ lat: '-6.2088', lon: 'abc' }).success).toBe(false)
  })

  it('rejects an empty latitude instead of coercing it to 0', () => {
    expect(ReverseGeocodeQuerySchema.safeParse({ lat: '', lon: '106.8456' }).success).toBe(false)
  })

  it('rejects an empty longitude instead of coercing it to 0', () => {
    expect(ReverseGeocodeQuerySchema.safeParse({ lat: '-6.2088', lon: '' }).success).toBe(false)
  })

  it('rejects whitespace-only coordinates', () => {
    expect(ReverseGeocodeQuerySchema.safeParse({ lat: '   ', lon: '   ' }).success).toBe(false)
  })

  it('still accepts a legitimate 0 coordinate', () => {
    const result = ReverseGeocodeQuerySchema.safeParse({ lat: '0', lon: '0' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual({ lat: 0, lon: 0 })
    }
  })
})

describe('parseNominatimSearchResult', () => {
  it('parses a well-formed single result', () => {
    const data = [{ display_name: 'Jakarta, Indonesia', lat: '-6.2088', lon: '106.8456' }]
    expect(parseNominatimSearchResult(data)).toEqual({
      address: 'Jakarta, Indonesia',
      latitude: -6.2088,
      longitude: 106.8456,
    })
  })

  it('returns null for an empty array (no match)', () => {
    expect(parseNominatimSearchResult([])).toBeNull()
  })

  it('returns null for an item missing display_name', () => {
    expect(parseNominatimSearchResult([{ lat: '-6.2088', lon: '106.8456' }])).toBeNull()
  })

  it('returns null for a non-array response (e.g. an error object)', () => {
    expect(parseNominatimSearchResult({ error: 'Unable to geocode' })).toBeNull()
  })
})

describe('parseNominatimReverseResult', () => {
  it('parses a well-formed result', () => {
    expect(parseNominatimReverseResult({ display_name: 'Jakarta, Indonesia' })).toEqual({
      address: 'Jakarta, Indonesia',
    })
  })

  it('returns null when display_name is missing', () => {
    expect(parseNominatimReverseResult({ error: 'Unable to geocode' })).toBeNull()
  })

  it('returns null for a non-object response', () => {
    expect(parseNominatimReverseResult(null)).toBeNull()
  })
})

describe('throttleNominatimRequest', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // The throttle keeps module-level state, so each test gets a fresh copy.
  async function freshThrottle() {
    vi.resetModules()
    const mod = await import('./geocode')
    return mod.throttleNominatimRequest
  }

  it('spaces concurrent callers one second apart instead of firing them together', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const throttle = await freshThrottle()

    const start = Date.now()
    const offsets: number[] = []
    const all = Promise.all(
      [0, 1, 2, 3].map(() =>
        throttle().then(() => {
          offsets.push(Date.now() - start)
        })
      )
    )

    await vi.advanceTimersByTimeAsync(10_000)
    await all

    // Without serialization every caller reads the same timestamp and they all
    // resolve at the same instant ([0, 0, 0, 0]).
    expect(offsets).toEqual([0, 1000, 2000, 3000])
  })

  it('does not delay a caller that arrives after the interval has already elapsed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const throttle = await freshThrottle()

    await throttle()
    vi.setSystemTime(new Date('2026-01-01T00:00:05Z'))

    const start = Date.now()
    let resolvedAt = -1
    const pending = throttle().then(() => {
      resolvedAt = Date.now() - start
    })
    await vi.advanceTimersByTimeAsync(0)
    await pending

    expect(resolvedAt).toBe(0)
  })
})
