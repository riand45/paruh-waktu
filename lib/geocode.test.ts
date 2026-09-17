import { describe, expect, it } from 'vitest'
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
