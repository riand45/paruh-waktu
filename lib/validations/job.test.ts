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

  it('rejects a deadline in the past', () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    expect(CreateJobSchema.safeParse({ ...valid, deadline: past }).success).toBe(false)
  })
})
