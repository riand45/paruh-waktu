import { describe, expect, it } from 'vitest'
import { haversineDistanceKm } from './geo'

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    const point = { latitude: -6.2088, longitude: 106.8456 }
    expect(haversineDistanceKm(point, point)).toBe(0)
  })

  it('is symmetric', () => {
    const jakarta = { latitude: -6.2088, longitude: 106.8456 }
    const bandung = { latitude: -6.9175, longitude: 107.6191 }
    expect(haversineDistanceKm(jakarta, bandung)).toBeCloseTo(
      haversineDistanceKm(bandung, jakarta),
      10
    )
  })

  it('returns a plausible real-world distance (Jakarta to Bandung, ~115-125km straight-line)', () => {
    const jakarta = { latitude: -6.2088, longitude: 106.8456 }
    const bandung = { latitude: -6.9175, longitude: 107.6191 }
    const distance = haversineDistanceKm(jakarta, bandung)
    expect(distance).toBeGreaterThan(100)
    expect(distance).toBeLessThan(140)
  })

  it('returns approximately 111km for 1 degree of latitude at the equator', () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 }
    )
    expect(distance).toBeGreaterThan(110)
    expect(distance).toBeLessThan(112)
  })
})
