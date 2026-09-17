import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { appError } from '@/lib/errors'
import { GeocodeQuerySchema, parseNominatimSearchResult, throttleNominatimRequest } from '@/lib/geocode'

// Required by Nominatim's usage policy: a descriptive User-Agent identifying
// the calling application (browsers can't set this themselves, which is why
// this proxy exists instead of calling Nominatim directly from the client).
const NOMINATIM_USER_AGENT = 'paruh-waktu-mvp/1.0'

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: appError('UNAUTHENTICATED').publicMessage }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const parsed = GeocodeQuerySchema.safeParse({ q: searchParams.get('q') ?? '' })
  if (!parsed.success) {
    return NextResponse.json({ error: appError('VALIDATION_ERROR').publicMessage }, { status: 400 })
  }

  await throttleNominatimRequest()

  let upstreamResponse: Response
  try {
    upstreamResponse = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=id&q=${encodeURIComponent(parsed.data.q)}`,
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
  const result = parseNominatimSearchResult(data)
  if (!result) {
    return NextResponse.json(
      { error: 'Alamat tidak ditemukan, coba kata kunci lain atau klik langsung di peta.' },
      { status: 404 }
    )
  }

  return NextResponse.json(result)
}
