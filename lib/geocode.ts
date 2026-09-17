import { z } from 'zod'

export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(1, { error: 'Kata kunci alamat wajib diisi.' }),
})

// Query params are always strings. `z.coerce.number()` alone would turn a
// missing/empty `lat`/`lon` into 0 (`Number('') === 0`), which is inside both
// valid ranges -- so `?lat=&lon=` would silently reverse-geocode (0, 0).
// Reject blank input before coercing.
export const ReverseGeocodeQuerySchema = z.object({
  // `z.coerce.number<string>()`: the explicit type argument narrows the coerced
  // schema's *input* type from `unknown` to `string` so `.pipe()` type-checks.
  lat: z
    .string()
    .trim()
    .min(1)
    .pipe(z.coerce.number<string>().min(-90).max(90)),
  lon: z
    .string()
    .trim()
    .min(1)
    .pipe(z.coerce.number<string>().min(-180).max(180)),
})

export interface GeocodeResult {
  address: string
  latitude: number
  longitude: number
}

export interface ReverseGeocodeResult {
  address: string
}

export function parseNominatimSearchResult(data: unknown): GeocodeResult | null {
  if (!Array.isArray(data) || data.length === 0) {
    return null
  }
  const item = data[0]
  if (typeof item !== 'object' || item === null) {
    return null
  }
  const { display_name: displayName, lat, lon } = item as Record<string, unknown>
  if (typeof displayName !== 'string' || typeof lat !== 'string' || typeof lon !== 'string') {
    return null
  }
  const latitude = Number(lat)
  const longitude = Number(lon)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }
  return { address: displayName, latitude, longitude }
}

export function parseNominatimReverseResult(data: unknown): ReverseGeocodeResult | null {
  if (typeof data !== 'object' || data === null) {
    return null
  }
  const { display_name: displayName } = data as Record<string, unknown>
  if (typeof displayName !== 'string' || displayName.length === 0) {
    return null
  }
  return { address: displayName }
}

// Nominatim's usage policy (https://operations.osmfoundation.org/policies/nominatim/)
// requires no more than one request per second. Best-effort, per-server-instance
// only -- see the plan's Global Constraints on why that's sufficient here.
const NOMINATIM_MIN_INTERVAL_MS = 1000
let lastNominatimRequestAt = 0

// Callers are serialized through a promise chain. Without it, concurrent
// callers would all read the same `lastNominatimRequestAt` before any of them
// wrote it back, sleep the identical remainder, and then fire simultaneously --
// which is exactly the burst the throttle exists to prevent.
let nominatimRequestQueue: Promise<void> = Promise.resolve()

export function throttleNominatimRequest(): Promise<void> {
  const next = nominatimRequestQueue.then(async () => {
    const elapsed = Date.now() - lastNominatimRequestAt
    if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed))
    }
    lastNominatimRequestAt = Date.now()
  })
  // Keep the chain alive even if a caller's continuation rejects, so one
  // failed request can't wedge the queue for every later caller.
  nominatimRequestQueue = next.catch(() => {})
  return next
}
