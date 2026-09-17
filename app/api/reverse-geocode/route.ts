import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { appError } from '@/lib/errors'
import {
  ReverseGeocodeQuerySchema,
  parseNominatimReverseResult,
  throttleNominatimRequest,
} from '@/lib/geocode'

const NOMINATIM_USER_AGENT = 'paruh-waktu-mvp/1.0'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: appError('UNAUTHENTICATED').publicMessage }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = ReverseGeocodeQuerySchema.safeParse({
    lat: searchParams.get('lat') ?? '',
    lon: searchParams.get('lon') ?? '',
  })
  if (!parsed.success) {
    return NextResponse.json({ error: appError('VALIDATION_ERROR').publicMessage }, { status: 400 })
  }

  await throttleNominatimRequest()

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${parsed.data.lat}&lon=${parsed.data.lon}`,
      {
        headers: { 'User-Agent': NOMINATIM_USER_AGENT },
        signal: AbortSignal.timeout(5000),
      }
    )
  } catch {
    return NextResponse.json({ error: 'Gagal menghubungi layanan peta, coba lagi.' }, { status: 502 })
  }

  if (!upstreamResponse.ok) {
    return NextResponse.json({ error: 'Gagal menghubungi layanan peta, coba lagi.' }, { status: 502 })
  }

  const data: unknown = await upstreamResponse.json()
  const result = parseNominatimReverseResult(data)
  if (!result) {
    return NextResponse.json({ error: 'Alamat tidak ditemukan untuk lokasi ini.' }, { status: 404 })
  }

  return NextResponse.json(result)
}
