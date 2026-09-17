import { describe, expect, it } from 'vitest'
import { CreateJobSchema } from './job'

describe('CreateJobSchema', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const valid = {
    title: 'Bantu Bersih-bersih Rumah',
    categoryId: '11111111-1111-1111-1111-111111111111',
    description: 'Butuh bantuan membersihkan rumah selama 2 jam pada akhir pekan.',
    address: 'Jl. Merdeka No. 1, Jakarta',
    latitude: '-6.2088',
    longitude: '106.8456',
    paymentAmount: '150000',
    durationMinutes: '120',
    deadline: future,
  }

  it('accepts valid input and coerces string numbers/dates', () => {
    const result = CreateJobSchema.safeParse(valid)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.latitude).toBe(-6.2088)
      expect(result.data.paymentAmount).toBe(150000)
      expect(result.data.durationMinutes).toBe(120)
      expect(result.data.deadline).toBeInstanceOf(Date)
    }
  })

  it('trims whitespace before validating the title', () => {
    const result = CreateJobSchema.safeParse({ ...valid, title: '  Bantu Bersih-bersih Rumah  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.title).toBe('Bantu Bersih-bersih Rumah')
    }
  })

  it('rejects a title shorter than 5 characters', () => {
    expect(CreateJobSchema.safeParse({ ...valid, title: 'Abc' }).success).toBe(false)
  })

  it('rejects an invalid categoryId', () => {
    expect(CreateJobSchema.safeParse({ ...valid, categoryId: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects a non-positive payment amount', () => {
    expect(CreateJobSchema.safeParse({ ...valid, paymentAmount: '0' }).success).toBe(false)
  })

  it('rejects a non-positive duration', () => {
    expect(CreateJobSchema.safeParse({ ...valid, durationMinutes: '-5' }).success).toBe(false)
  })

  it('rejects an out-of-range latitude', () => {
    expect(CreateJobSchema.safeParse({ ...valid, latitude: '200' }).success).toBe(false)
  })

  it('rejects an out-of-range longitude', () => {
    expect(CreateJobSchema.safeParse({ ...valid, longitude: '-200' }).success).toBe(false)
  })

  it('rejects an empty latitude instead of coercing it to 0', () => {
    const result = CreateJobSchema.safeParse({ ...valid, latitude: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.latitude).toEqual(['Pilih lokasi pada peta.'])
    }
  })

  it('rejects an empty longitude instead of coercing it to 0', () => {
    const result = CreateJobSchema.safeParse({ ...valid, longitude: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.longitude).toEqual(['Pilih lokasi pada peta.'])
    }
  })

  it('rejects whitespace-only coordinates', () => {
    expect(CreateJobSchema.safeParse({ ...valid, latitude: '   ' }).success).toBe(false)
    expect(CreateJobSchema.safeParse({ ...valid, longitude: '   ' }).success).toBe(false)
  })

  it('rejects missing coordinates (no location field submitted at all)', () => {
    const withoutCoordinates: Record<string, unknown> = { ...valid }
    delete withoutCoordinates.latitude
    delete withoutCoordinates.longitude
    const result = CreateJobSchema.safeParse(withoutCoordinates)
    expect(result.success).toBe(false)
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors
      expect(fieldErrors.latitude).toEqual(['Pilih lokasi pada peta.'])
      expect(fieldErrors.longitude).toEqual(['Pilih lokasi pada peta.'])
    }
  })

  it('rejects non-numeric coordinates', () => {
    expect(CreateJobSchema.safeParse({ ...valid, latitude: 'abc' }).success).toBe(false)
    expect(CreateJobSchema.safeParse({ ...valid, longitude: 'abc' }).success).toBe(false)
  })

  it('still accepts valid coordinates, including a legitimate 0', () => {
    const result = CreateJobSchema.safeParse({ ...valid, latitude: '0', longitude: '0' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.latitude).toBe(0)
      expect(result.data.longitude).toBe(0)
    }
  })

  // createJob()/updateJob() in lib/services/jobs.ts re-validate their already-
  // parsed input, so parsing this schema's own output must keep succeeding.
  it('is idempotent: parsing its own output succeeds (services re-validate)', () => {
    const first = CreateJobSchema.parse(valid)
    const second = CreateJobSchema.safeParse(first)
    expect(second.success).toBe(true)
    if (second.success) {
      expect(second.data.latitude).toBe(-6.2088)
      expect(second.data.longitude).toBe(106.8456)
    }
  })

  it('still range-checks numeric (already-coerced) coordinates', () => {
    expect(CreateJobSchema.safeParse({ ...valid, latitude: 200 }).success).toBe(false)
    expect(CreateJobSchema.safeParse({ ...valid, longitude: -200 }).success).toBe(false)
  })

  it('rejects a deadline in the past', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(CreateJobSchema.safeParse({ ...valid, deadline: past }).success).toBe(false)
  })
})
