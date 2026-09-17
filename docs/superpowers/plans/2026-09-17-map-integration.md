# Map Integration (Leaflet + OpenStreetMap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's manual lat/lng number inputs and outbound-link-only location display with an interactive Leaflet+OpenStreetMap picker (job create/edit), an in-app map display (job detail), and a map view (job browse) — plus a server-side geocoding proxy so the typed address and the pin stay in sync.

**Architecture:** A shared `BaseMap` client component wraps `react-leaflet`'s `MapContainer`/`TileLayer` once; three feature components (`MapPicker`, `MapDisplay`, `JobsMap`) build on it, each split into a real implementation file plus a `next/dynamic(..., { ssr: false })` public wrapper (Leaflet touches `window` at import time and must never reach the server). Two new Route Handlers proxy Nominatim (OSM's geocoding API) so the browser never calls it directly, since Nominatim requires a custom `User-Agent` (which browsers can't set) and a strict rate limit.

**Tech Stack:** Next.js 16 App Router, React 19, `leaflet` + `react-leaflet` (new dependencies), Zod, Vitest — no other new dependency.

**Spec:** `docs/superpowers/specs/2026-09-17-map-integration-design.md`

## Global Constraints

- Leaflet + OpenStreetMap only — no other map/tile provider (PRD §3 tech-stack requirement).
- Exact pinned versions: `leaflet@1.9.4`, `react-leaflet@5.0.0` (first major version supporting React 19), `@types/leaflet@1.9.22` — matches this repo's `react@19.2.8`/`react-dom@19.2.8`.
- No schema/RLS changes. `jobs.latitude`/`longitude`/`address` and `CreateJobSchema`/`UpdateJobSchema` in `lib/validations/job.ts` are unchanged — this phase is presentation/integration only.
- Both new Route Handlers (`/api/geocode`, `/api/reverse-geocode`) require `getCurrentUser()` to resolve non-null (401 JSON otherwise) — never an open, unauthenticated relay to Nominatim.
- Every outbound Nominatim call sets a descriptive `User-Agent`, waits for a 1-request/second in-memory throttle, and uses a 5-second `AbortSignal.timeout`.
- Address text stays freely user-editable after any geocoding fill — geocoding only ever suggests a value, never enforces one.
- No marker clustering. Job browse defaults to List view (mobile-first).
- `react-leaflet`/`leaflet` are never statically imported into a Server Component and never SSR'd — every real map implementation file is reached only through a `next/dynamic(..., { ssr: false })` wrapper living in its own Client Component file.
- Map/Leaflet rendering itself is not unit-tested (jsdom cannot reliably render it) — only `lib/geocode.ts`'s pure functions and the two Zod query schemas get automated tests. Final verification (Task 7) is a real Playwright walkthrough against the running app, matching this repo's established practice for library-heavy UI (e.g. Phase 9's realtime chat).

---

### Task 1: Dependencies + shared `BaseMap` component

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Create: `components/map/base-map.tsx`

**Interfaces:**
- Produces: `BaseMap({ center: [number, number], zoom: number, className?: string, children?: ReactNode })`, `MapClickHandler({ onClick: (lat: number, lng: number) => void })`, `INDONESIA_CENTER: [number, number]`, `INDONESIA_DEFAULT_ZOOM: number` — all consumed by Tasks 4-6.

- [ ] **Step 1: Install the map dependencies**

```bash
npm install leaflet@1.9.4 react-leaflet@5.0.0
npm install -D @types/leaflet@1.9.22
```

- [ ] **Step 2: Verify the install**

Run: `cat package.json | grep -A2 '"leaflet"\|"react-leaflet"'`
Expected: `leaflet": "1.9.4"`, `react-leaflet": "5.0.0"` (or `^`-prefixed equivalents) both present in `dependencies`, and `@types/leaflet` in `devDependencies`.

- [ ] **Step 3: Create `components/map/base-map.tsx`**

```tsx
'use client'

import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import type { ReactNode } from 'react'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'

// react-leaflet's bundled default marker icon references image paths that
// break under most Next.js bundler configs. Pointing at unpkg (pinned to
// the exact installed leaflet version) sidesteps that entirely instead of
// depending on this app's specific webpack/Turbopack asset-import setup.
type IconDefaultPrototype = typeof L.Icon.Default.prototype & { _getIconUrl?: unknown }
delete (L.Icon.Default.prototype as IconDefaultPrototype)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const INDONESIA_CENTER: [number, number] = [-2.5, 118]
export const INDONESIA_DEFAULT_ZOOM = 5

export interface BaseMapProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: ReactNode
}

export function BaseMap({ center, zoom, className, children }: BaseMapProps) {
  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} className={className ?? 'h-64 w-full rounded-md'}>
      <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
      {children}
    </MapContainer>
  )
}

export function MapClickHandler({ onClick }: { onClick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      onClick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `import L from 'leaflet'` errors under this project's TS config, switch it to `import * as L from 'leaflet'` and re-run.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components/map/base-map.tsx
git commit -m "feat(map): add Leaflet/react-leaflet dependencies and shared BaseMap component"
```

---

### Task 2: `lib/geocode.ts` — Nominatim parsing, query schemas, throttle

**Files:**
- Create: `lib/geocode.ts`
- Test: `lib/geocode.test.ts`

**Interfaces:**
- Produces: `GeocodeQuerySchema`, `ReverseGeocodeQuerySchema` (Zod), `GeocodeResult { address: string; latitude: number; longitude: number }`, `ReverseGeocodeResult { address: string }`, `parseNominatimSearchResult(data: unknown): GeocodeResult | null`, `parseNominatimReverseResult(data: unknown): ReverseGeocodeResult | null`, `throttleNominatimRequest(): Promise<void>` — all consumed by Task 3's Route Handlers.

- [ ] **Step 1: Write the failing test file `lib/geocode.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/geocode.test.ts`
Expected: FAIL — `Cannot find module './geocode'` (the module doesn't exist yet).

- [ ] **Step 3: Create `lib/geocode.ts`**

```ts
import { z } from 'zod'

export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(1, { error: 'Kata kunci alamat wajib diisi.' }),
})

export const ReverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
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

export async function throttleNominatimRequest(): Promise<void> {
  const elapsed = Date.now() - lastNominatimRequestAt
  if (elapsed < NOMINATIM_MIN_INTERVAL_MS) {
    await new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS - elapsed))
  }
  lastNominatimRequestAt = Date.now()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/geocode.test.ts`
Expected: PASS — all 13 tests green.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint lib/geocode.ts lib/geocode.test.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/geocode.ts lib/geocode.test.ts
git commit -m "feat(map): add Nominatim response parsing, query schemas, and rate-limit helper"
```

---

### Task 3: Geocoding proxy Route Handlers

**Files:**
- Create: `app/api/geocode/route.ts`
- Create: `app/api/reverse-geocode/route.ts`

**Interfaces:**
- Consumes: `getCurrentUser()` from `lib/auth/get-current-user.ts`; `appError` from `lib/errors.ts`; `GeocodeQuerySchema`, `ReverseGeocodeQuerySchema`, `parseNominatimSearchResult`, `parseNominatimReverseResult`, `throttleNominatimRequest` from `lib/geocode.ts` (Task 2).
- Produces: `GET /api/geocode?q=<text>` → `200 { address, latitude, longitude }` or `{ error: string }` with `401`/`400`/`404`/`502`. `GET /api/reverse-geocode?lat=&lon=` → `200 { address }` or `{ error: string }` with the same status codes. Consumed by Task 4's `MapPicker`.

- [ ] **Step 1: Create `app/api/geocode/route.ts`**

```ts
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
```

- [ ] **Step 2: Create `app/api/reverse-geocode/route.ts`**

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke check against the dev server**

Run: `npm run dev` (in one terminal), then in another:
```bash
curl -i "http://localhost:3000/api/geocode?q=Jakarta"
curl -i "http://localhost:3000/api/reverse-geocode?lat=-6.2088&lon=106.8456"
```
Expected: both return `HTTP/1.1 401` with `{"error":"Anda harus masuk untuk melakukan tindakan ini."}` (no session cookie was sent) — confirms the auth gate fires before any Nominatim call. Stop the dev server after this check (Task 4 will need it again with a real login).

- [ ] **Step 5: Commit**

```bash
git add app/api/geocode/route.ts app/api/reverse-geocode/route.ts
git commit -m "feat(map): add authenticated geocoding proxy Route Handlers"
```

---

### Task 4: `MapPicker` component + wire into job create/edit

**Files:**
- Create: `components/map/map-picker-impl.tsx`
- Create: `components/map/map-picker.tsx`
- Modify: `app/(main)/jobs/job-form.tsx`

**Interfaces:**
- Consumes: `BaseMap`, `MapClickHandler`, `INDONESIA_CENTER`, `INDONESIA_DEFAULT_ZOOM` from `components/map/base-map.tsx` (Task 1); `GET /api/geocode`, `GET /api/reverse-geocode` (Task 3).
- Produces: `MapPickerValue { address: string; latitude: string; longitude: string }`, `MapPicker({ value: MapPickerValue, onChange: (next: MapPickerValue) => void })` — the public, dynamically-loaded component other files import from `components/map/map-picker.tsx`.

- [ ] **Step 1: Create `components/map/map-picker-impl.tsx`**

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Marker } from 'react-leaflet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BaseMap, MapClickHandler, INDONESIA_CENTER, INDONESIA_DEFAULT_ZOOM } from './base-map'

export interface MapPickerValue {
  address: string
  latitude: string
  longitude: string
}

const GEOCODE_DEBOUNCE_MS = 500

export function MapPicker({
  value,
  onChange,
}: {
  value: MapPickerValue
  onChange: (next: MapPickerValue) => void
}) {
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const hasPosition = value.latitude !== '' && value.longitude !== ''
  const center: [number, number] = hasPosition
    ? [Number(value.latitude), Number(value.longitude)]
    : INDONESIA_CENTER
  const zoom = hasPosition ? 15 : INDONESIA_DEFAULT_ZOOM

  const runReverseGeocode = useCallback(
    async (latitude: number, longitude: number) => {
      setMapError(null)
      try {
        const response = await fetch(`/api/reverse-geocode?lat=${latitude}&lon=${longitude}`)
        const data: { address?: string; error?: string } = await response.json()
        if (!response.ok || !data.address) {
          setMapError(data.error ?? 'Gagal menghubungi layanan peta, coba lagi.')
          onChange({ ...value, latitude: String(latitude), longitude: String(longitude) })
          return
        }
        onChange({ address: data.address, latitude: String(latitude), longitude: String(longitude) })
      } catch {
        setMapError('Gagal menghubungi layanan peta, coba lagi.')
        onChange({ ...value, latitude: String(latitude), longitude: String(longitude) })
      }
    },
    [onChange, value]
  )

  function handleMapClick(latitude: number, longitude: number) {
    void runReverseGeocode(latitude, longitude)
  }

  function handleMarkerDragEnd(event: L.DragEndEvent) {
    const marker = event.target as L.Marker
    const { lat, lng } = marker.getLatLng()
    void runReverseGeocode(lat, lng)
  }

  function handleAddressChange(nextAddress: string) {
    onChange({ ...value, address: nextAddress })

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (nextAddress.trim().length === 0) return

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setMapError(null)
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(nextAddress)}`)
        const data: { address?: string; latitude?: number; longitude?: number; error?: string } =
          await response.json()
        if (!response.ok || data.latitude === undefined || data.longitude === undefined || !data.address) {
          setMapError(
            data.error ?? 'Alamat tidak ditemukan, coba kata kunci lain atau klik langsung di peta.'
          )
          return
        }
        onChange({ address: data.address, latitude: String(data.latitude), longitude: String(data.longitude) })
      } catch {
        setMapError('Gagal menghubungi layanan peta, coba lagi.')
      } finally {
        setSearching(false)
      }
    }, GEOCODE_DEBOUNCE_MS)
  }

  function handleUseMyLocation() {
    setMapError(null)
    if (!navigator.geolocation) {
      setMapError('Browser Anda tidak mendukung deteksi lokasi.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        void runReverseGeocode(position.coords.latitude, position.coords.longitude)
      },
      () => {
        setLocating(false)
        setMapError('Izin lokasi ditolak atau gagal mendeteksi lokasi.')
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Input
          placeholder="Cari alamat atau klik di peta..."
          value={value.address}
          onChange={(event) => handleAddressChange(event.target.value)}
        />
        {searching && <p className="text-xs text-muted-foreground">Mencari alamat...</p>}
      </div>
      <BaseMap center={center} zoom={zoom} className="h-64 w-full rounded-md">
        <MapClickHandler onClick={handleMapClick} />
        {hasPosition && (
          <Marker
            position={center}
            draggable
            eventHandlers={{ dragend: handleMarkerDragEnd }}
          />
        )}
      </BaseMap>
      <Button type="button" variant="outline" onClick={handleUseMyLocation} disabled={locating}>
        {locating ? 'Mendeteksi...' : 'Gunakan Lokasi Saya'}
      </Button>
      {mapError && <p className="text-sm text-destructive">{mapError}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Add the `L` type import needed by `handleMarkerDragEnd`**

`map-picker-impl.tsx` references `L.DragEndEvent`/`L.Marker` as types only. Add this import alongside the existing ones at the top of the file:

```tsx
import type L from 'leaflet'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `L.DragEndEvent` isn't exported under that exact name by `@types/leaflet@1.9.22`, use the react-leaflet event's actual inferred type instead — check by hovering/inspecting `eventHandlers`'s expected type in the editor, or fall back to `(event: { target: L.Marker }) => { ... }`.

- [ ] **Step 4: Create the public wrapper `components/map/map-picker.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export type { MapPickerValue } from './map-picker-impl'

export const MapPicker = dynamic(() => import('./map-picker-impl').then((mod) => mod.MapPicker), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-md" />,
})
```

- [ ] **Step 5: Wire `MapPicker` into `app/(main)/jobs/job-form.tsx`**

Replace the imports at the top of the file:

```tsx
'use client'

import { useActionState, useState } from 'react'
import type { JobFormState } from '@/lib/validations/job'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MapPicker, type MapPickerValue } from '@/components/map/map-picker'
```

Replace the address/latitude/longitude block (currently the standalone "Alamat" field followed by the "Latitude"/"Longitude" grid) with:

```tsx
      <div className="flex flex-col gap-1.5">
        <Label>Lokasi</Label>
        <MapPicker value={location} onChange={setLocation} />
        <input type="hidden" name="address" value={location.address} />
        <input type="hidden" name="latitude" value={location.latitude} />
        <input type="hidden" name="longitude" value={location.longitude} />
        {state?.errors?.address && (
          <p className="text-sm text-destructive">{state.errors.address[0]}</p>
        )}
        {state?.errors?.latitude && (
          <p className="text-sm text-destructive">{state.errors.latitude[0]}</p>
        )}
        {state?.errors?.longitude && (
          <p className="text-sm text-destructive">{state.errors.longitude[0]}</p>
        )}
      </div>
```

And add the lifted `location` state right after the existing `useActionState` line inside the `JobForm` function body:

```tsx
  const [state, formAction, pending] = useActionState(action, undefined)
  const [location, setLocation] = useState<MapPickerValue>({
    address: defaultValues?.address ?? '',
    latitude: defaultValues?.latitude ?? '',
    longitude: defaultValues?.longitude ?? '',
  })
```

Every other field (`title`, `categoryId`, `description`, `paymentAmount`, `durationMinutes`, `deadline`) is untouched.

- [ ] **Step 6: Typecheck, lint, and run the existing test suite**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors; all existing tests (including `lib/validations/job.test.ts`) still pass unchanged, since the Zod schema and the submitted field names (`address`/`latitude`/`longitude`) are identical to before.

- [ ] **Step 7: Manual check against the dev server**

Run: `npm run dev`, log in as a verified employer, go to `/jobs/new`. Confirm: typing an address (e.g. "Monas Jakarta") after a brief pause moves the map pin and shows a marker; dragging the marker updates the address text; clicking "Gunakan Lokasi Saya" (allow the browser's location permission prompt) also moves the pin. Submit the form and confirm the created job's detail page shows the same address you ended up with.

- [ ] **Step 8: Commit**

```bash
git add components/map/map-picker-impl.tsx components/map/map-picker.tsx "app/(main)/jobs/job-form.tsx"
git commit -m "feat(map): add interactive MapPicker and wire it into job create/edit"
```

---

### Task 5: `MapDisplay` component + wire into job detail

**Files:**
- Create: `components/map/map-display-impl.tsx`
- Create: `components/map/map-display.tsx`
- Modify: `app/(main)/jobs/[id]/page.tsx`

**Interfaces:**
- Consumes: `BaseMap` from `components/map/base-map.tsx` (Task 1).
- Produces: `MapDisplay({ latitude: number, longitude: number })` — the public, dynamically-loaded component `app/(main)/jobs/[id]/page.tsx` (a Server Component) renders directly.

- [ ] **Step 1: Create `components/map/map-display-impl.tsx`**

```tsx
'use client'

import { Marker } from 'react-leaflet'
import { BaseMap } from './base-map'

export function MapDisplay({ latitude, longitude }: { latitude: number; longitude: number }) {
  return (
    <BaseMap center={[latitude, longitude]} zoom={15} className="h-48 w-full rounded-md">
      <Marker position={[latitude, longitude]} />
    </BaseMap>
  )
}
```

- [ ] **Step 2: Create the public wrapper `components/map/map-display.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export const MapDisplay = dynamic(() => import('./map-display-impl').then((mod) => mod.MapDisplay), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full rounded-md" />,
})
```

- [ ] **Step 3: Wire it into `app/(main)/jobs/[id]/page.tsx`**

Add the import alongside the existing ones:

```tsx
import { MapDisplay } from '@/components/map/map-display'
```

Add the map right before the existing "Lihat Lokasi di Google Maps" link:

```tsx
      <MapDisplay latitude={job.latitude} longitude={job.longitude} />
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Lihat Lokasi di Google Maps
      </a>
```

- [ ] **Step 4: Typecheck, lint, run tests**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors, all tests still pass.

- [ ] **Step 5: Manual check against the dev server**

Run: `npm run dev`, open any existing job's detail page (`/jobs/[id]`). Confirm a map renders with a single pin at the job's location, and the "Lihat Lokasi di Google Maps" link still opens correctly in a new tab.

- [ ] **Step 6: Commit**

```bash
git add components/map/map-display-impl.tsx components/map/map-display.tsx "app/(main)/jobs/[id]/page.tsx"
git commit -m "feat(map): add MapDisplay and show it on the job detail page"
```

---

### Task 6: `JobsMap` component + browse view toggle

**Files:**
- Modify: `lib/services/jobs.ts` (add `latitude`/`longitude` to `JobListing`)
- Create: `components/map/jobs-map-impl.tsx`
- Create: `components/map/jobs-map.tsx`
- Create: `app/(main)/jobs/jobs-view-toggle.tsx`
- Modify: `app/(main)/jobs/page.tsx`

**Interfaces:**
- Consumes: `BaseMap` from `components/map/base-map.tsx` (Task 1); `getJobListing` from `lib/services/jobs.ts`.
- Produces: `JobMapPin { id: string; title: string; paymentAmount: number; distanceKm: number | null; latitude: number; longitude: number }`, `JobsMap({ jobs: JobMapPin[] })` — the public, dynamically-loaded component `app/(main)/jobs/page.tsx` renders.

- [ ] **Step 1: Add `latitude`/`longitude` to `JobListing` in `lib/services/jobs.ts`**

The query already selects `latitude`/`longitude` (used internally for `distanceKm`) — they're just not currently passed through. Update the interface:

```ts
export interface JobListing {
  id: string
  title: string
  categoryId: string
  address: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  distanceKm: number | null
  latitude: number
  longitude: number
}
```

And the mapping inside `getJobListing`:

```ts
  let jobs: JobListing[] = rows.map((job) => ({
    id: job.id,
    title: job.title,
    categoryId: job.category_id,
    address: job.address,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    latitude: job.latitude,
    longitude: job.longitude,
    distanceKm: hasLocation
      ? haversineDistanceKm(
          { latitude: filters.workerLat as number, longitude: filters.workerLng as number },
          { latitude: job.latitude, longitude: job.longitude }
        )
      : null,
  }))
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors — this is a purely additive interface change; no existing consumer of `JobListing` breaks.

- [ ] **Step 3: Create `components/map/jobs-map-impl.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Marker, Popup, useMap } from 'react-leaflet'
import { BaseMap, INDONESIA_CENTER, INDONESIA_DEFAULT_ZOOM } from './base-map'

export interface JobMapPin {
  id: string
  title: string
  paymentAmount: number
  distanceKm: number | null
  latitude: number
  longitude: number
}

function FitToPins({ pins }: { pins: JobMapPin[] }) {
  const map = useMap()
  useEffect(() => {
    if (pins.length === 0) return
    if (pins.length === 1) {
      map.setView([pins[0].latitude, pins[0].longitude], 14)
      return
    }
    map.fitBounds(
      pins.map((pin): [number, number] => [pin.latitude, pin.longitude]),
      { padding: [32, 32] }
    )
  }, [map, pins])
  return null
}

export function JobsMap({ jobs }: { jobs: JobMapPin[] }) {
  return (
    <BaseMap center={INDONESIA_CENTER} zoom={INDONESIA_DEFAULT_ZOOM} className="h-96 w-full rounded-md">
      <FitToPins pins={jobs} />
      {jobs.map((job) => (
        <Marker key={job.id} position={[job.latitude, job.longitude]}>
          <Popup>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{job.title}</span>
              <span>Rp{job.paymentAmount.toLocaleString('id-ID')}</span>
              {job.distanceKm !== null && <span>{job.distanceKm.toFixed(1)} km</span>}
              <Link href={`/jobs/${job.id}`} className="text-primary underline-offset-4 hover:underline">
                Lihat Detail
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </BaseMap>
  )
}
```

- [ ] **Step 4: Create the public wrapper `components/map/jobs-map.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export type { JobMapPin } from './jobs-map-impl'

export const JobsMap = dynamic(() => import('./jobs-map-impl').then((mod) => mod.JobsMap), {
  ssr: false,
  loading: () => <Skeleton className="h-96 w-full rounded-md" />,
})
```

- [ ] **Step 5: Create `app/(main)/jobs/jobs-view-toggle.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export function JobsViewToggle() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'map' ? 'map' : 'list'

  function hrefFor(nextView: 'list' | 'map') {
    const params = new URLSearchParams(searchParams.toString())
    if (nextView === 'list') {
      params.delete('view')
    } else {
      params.set('view', nextView)
    }
    const query = params.toString()
    return query ? `/jobs?${query}` : '/jobs'
  }

  return (
    <div className="flex gap-2">
      <Link
        href={hrefFor('list')}
        className={cn(
          'rounded-md border px-3 py-1.5 text-sm',
          view === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background'
        )}
      >
        Daftar
      </Link>
      <Link
        href={hrefFor('map')}
        className={cn(
          'rounded-md border px-3 py-1.5 text-sm',
          view === 'map' ? 'bg-primary text-primary-foreground' : 'bg-background'
        )}
      >
        Peta
      </Link>
    </div>
  )
}
```

- [ ] **Step 6: Wire the toggle and `JobsMap` into `app/(main)/jobs/page.tsx`**

Add these imports:

```tsx
import { JobsMap, type JobMapPin } from '@/components/map/jobs-map'
import { JobsViewToggle } from './jobs-view-toggle'
```

Inside `JobsPage`, after `const jobs = await getJobListing({...})`, add:

```tsx
  const view = params.view === 'map' ? 'map' : 'list'
  const mapPins: JobMapPin[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    paymentAmount: job.paymentAmount,
    distanceKm: job.distanceKm,
    latitude: job.latitude,
    longitude: job.longitude,
  }))
```

Replace the return block's filter/list section with:

```tsx
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <JobFilters categories={categories} />
      </Suspense>
      <JobsViewToggle />
      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada pekerjaan ditemukan.</p>
      )}
      {view === 'map' ? (
        jobs.length > 0 && <JobsMap jobs={mapPins} />
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="flex flex-col gap-1 rounded border p-3 text-sm hover:bg-muted"
              >
                <span className="font-medium">{job.title}</span>
                <span className="text-muted-foreground">{job.address}</span>
                <span>Rp{job.paymentAmount.toLocaleString('id-ID')}</span>
                {job.distanceKm !== null && (
                  <span className="text-muted-foreground">{job.distanceKm.toFixed(1)} km</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
```

- [ ] **Step 7: Typecheck, lint, run tests**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run`
Expected: no errors, all tests still pass.

- [ ] **Step 8: Manual check against the dev server**

Run: `npm run dev`, go to `/jobs`. Confirm the "Daftar"/"Peta" toggle appears, defaults to Daftar (list), and clicking "Peta" switches to a map with a pin per currently-filtered job, auto-fit to show them all; clicking a pin's popup "Lihat Detail" link navigates to that job. Apply a filter (e.g. a category) and confirm the map view updates to match.

- [ ] **Step 9: Commit**

```bash
git add lib/services/jobs.ts components/map/jobs-map-impl.tsx components/map/jobs-map.tsx "app/(main)/jobs/jobs-view-toggle.tsx" "app/(main)/jobs/page.tsx"
git commit -m "feat(map): add JobsMap and a list/map view toggle to job browse"
```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full verification suite**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npm run build`
Expected: all four pass with no errors.

- [ ] **Step 2: Start the dev server for the Playwright DoD walkthrough**

Run: `npm run dev`

- [ ] **Step 3: Job create — geocoding + pin sync**

As a verified employer, go to `/jobs/new`. Search an address in the picker → confirm the pin moves and the hidden lat/lng update (submit and check the created job's stored values match). Drag the pin → confirm the address field updates. Submit → confirm the job detail page shows the same address/location.

- [ ] **Step 4: Job detail — map display**

Open any job's detail page. Confirm the map renders a single pin at the correct location and the "Lihat Lokasi di Google Maps" link still works.

- [ ] **Step 5: Job browse — map view**

Go to `/jobs`, toggle to "Peta". Confirm pins appear only for the currently-filtered job set (test with a category filter applied), and clicking a pin's popup link navigates to that job's detail page.

- [ ] **Step 6: Geocoding failure path (must not be skipped)**

Temporarily break the geocoding proxy — e.g. in `lib/geocode.ts`, change the throttle export or, simpler, temporarily point one Route Handler's `fetch` URL at an invalid host (`https://invalid.invalid/search`) — then reload `/jobs/new` and try searching an address. Confirm: an inline error message appears, the form is NOT stuck or broken, and clicking directly on the map still places a pin (which needs no geocoding call) that can be submitted successfully. Revert the temporary change afterward.

- [ ] **Step 7: Revert any temporary breakage from Step 6 and confirm clean state**

Run: `git status`
Expected: no uncommitted changes (Step 6's temporary edit was reverted, not committed).

- [ ] **Step 8: Report results**

Confirm to the user: all automated checks passed, and each of Steps 3-6 was manually verified against the real running app (not just inferred from code review) — matching this repo's established Definition-of-Done standard for library-heavy UI features.

---

## Self-Review Notes

- **Spec coverage:** §4 BaseMap → Task 1. §5 MapPicker + job-form integration → Task 4. §6 geocoding proxy → Tasks 2-3. §7 MapDisplay → Task 5. §8 JobsMap + browse toggle → Task 6. §9 error handling → built into Tasks 3/4/6 and explicitly re-verified in Task 7 Step 6. §10 rate limiting → Task 2's `throttleNominatimRequest`. §11 testing → Task 2's test file (automated) + Task 7 (manual DoD walkthrough). Every spec section has a corresponding task.
- **Placeholder scan:** no TBD/TODO; every step has real, complete code or a concrete manual-check procedure.
- **Type consistency:** `MapPickerValue { address, latitude, longitude }` (all `string`, matching the native form's field values) is defined once in `map-picker-impl.tsx` and re-exported by `map-picker.tsx` — `job-form.tsx` imports the type only from the public wrapper. `JobMapPin` is likewise defined once in `jobs-map-impl.tsx` and re-exported by `jobs-map.tsx`. `JobListing`'s new `latitude`/`longitude: number` fields (Task 6, Step 1) match the `number` types already used elsewhere in `lib/services/jobs.ts` for the same columns (see `JobDetail`).
