# Map Integration (Leaflet + OpenStreetMap) — Design

## 1. Purpose

A whole-codebase security review (2026-09-17) followed by a Definition-of-Done pass against the PRD's own §63 checklist found that "Map" — an explicit tech-stack requirement (§3: "Leaflet, OpenStreetMap") and an explicit §14/§47 component ("MapPicker", reusable map components) — was never built. Job location today is two manually-typed number inputs (`latitude`/`longitude` in `app/(main)/jobs/job-form.tsx`) with no geocoding, and job detail's only spatial UI is a single outbound `<a>` link to Google Maps (`app/(main)/jobs/[id]/page.tsx`). Job browsing (`app/(main)/jobs/page.tsx`) is list-only.

This closes that gap in three places: an interactive map picker on job create/edit, an in-app map display on job detail, and a map view on job browse — plus geocoding so the typed address and the pin stay in sync instead of silently disagreeing (a gap the DoD review also flagged).

This phase is presentation- and integration-layer only — no schema changes (`jobs.latitude`/`longitude`/`address` already exist and are validated by the existing `CreateJobSchema`/`UpdateJobSchema` in `lib/validations/job.ts`), no RLS changes, no change to any existing authorization behavior.

Implementation note: per this repo's `AGENTS.md`, `node_modules/next/dist/docs/` must be checked before writing code against this pinned Next.js version (16.3.4) for anything version-sensitive here — specifically: where global CSS (`leaflet/dist/leaflet.css`) may be imported from in the App Router, and whether the new `app/api/geocode` / `app/api/reverse-geocode` Route Handlers need anything version-specific (e.g. typed route params). Confirm at plan/implementation time, not from prior training data.

## 2. Out of scope (explicitly deferred)

- **Marker clustering** on the browse map view. Job counts are small at this MVP's scale (~50 users); clustering is premature until real usage data suggests otherwise.
- **Self-hosted Nominatim or a paid geocoding provider.** Uses the public `nominatim.openstreetmap.org` endpoint directly. Revisit only if usage grows enough to strain OSM's free-tier usage policy.
- **Multi-result address autocomplete dropdown.** The address search box takes one debounced query and geocodes to a single best match, not a list of candidate suggestions to choose from — simpler, fewer Nominatim calls, and the pin remains manually adjustable afterward regardless.
- **Any change to `job-filters.tsx`'s existing keyword/category/payment/radius filtering logic.** The browse map view visualizes whatever the existing filtered list already contains; it adds no new filter capability of its own.
- **Satellite/hybrid tile layers, offline tile caching, or any OSM data-editing capability.** Standard OSM raster tiles only, matching the PRD's plain "Leaflet + OpenStreetMap" requirement.
- **A distributed/shared rate limiter for the geocoding proxy.** In-memory, per-server-instance throttling only (see §10) — sufficient at this app's "keep infrastructure simple" deployment scale; a Redis-backed limiter would be premature.

## 3. Dependencies

`leaflet`, `react-leaflet` (v5 — the first major version with React 19 support, matching this repo's `react@19.2.8`), `@types/leaflet`. No other new dependency; `lucide-react` (already used, e.g. by `bottom-nav.tsx`) supplies any icon needs.

## 4. Shared base: `components/map/base-map.tsx` (new, client component)

Wraps `react-leaflet`'s `MapContainer` + a single OSM `TileLayer` (`https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, required `&copy; OpenStreetMap contributors` attribution) so every other map component shares one place for tile-layer/attribution boilerplate — matching PRD §14's "map provider should be replaceable in the future" (swapping tile providers means editing one file). Exported via `next/dynamic(() => import(...), { ssr: false })` from each consumer, since Leaflet touches `window`/`document` and cannot run during server rendering. Takes `center`, `zoom`, and `children` (markers), plus an optional `onMapClick` for the picker's click-to-place behavior. Contains no API/business logic and no Supabase calls, per PRD §14.

## 5. `components/map/map-picker.tsx` (new, client component) — job create/edit

Renders: `BaseMap` with one draggable marker, a debounced (~500ms) address search `Input` above it, and a "Gunakan Lokasi Saya" button reusing the same `navigator.geolocation.getCurrentPosition` pattern already used in `app/(main)/jobs/job-filters.tsx`'s "Terdekat" button.

Holds its own controlled `{ address, latitude, longitude }` state, seeded from props for edit forms. Three sync directions, all one-way triggers that only *suggest* a value — the user can always hand-edit the address text afterward, so geocoding is a convenience, never an enforced source of truth:
- Typing in the address box (debounced) → calls `GET /api/geocode?q=` → moves the marker + fills latitude/longitude.
- Dragging the marker or clicking elsewhere on the map → calls `GET /api/reverse-geocode?lat=&lon=` → fills the address box.
- Clicking "Gunakan Lokasi Saya" → browser geolocation → moves the marker → triggers the same reverse-geocode as a drag would.

### Integration with the existing native form (`job-form.tsx`)

`job-form.tsx` submits via a plain `<form action={formAction}>` + `useActionState` (no react-hook-form), with `latitude`/`longitude`/`address` currently three separate uncontrolled `defaultValue` inputs. `MapPicker` replaces that block but keeps the same native-submission model: `job-form.tsx` lifts `{ address, latitude, longitude }` into its own `useState` (seeded from `defaultValues`), passes it to `MapPicker` as a controlled value + `onChange`, and renders three `<input type="hidden">` fields (`name="address"`, `name="latitude"`, `name="longitude"`) mirroring that state — so `CreateJobSchema`/`UpdateJobSchema` and the Server Actions behind them need zero changes; only the form's own JSX changes. The visible, editable address `<Input>` lives inside `MapPicker` itself (bound to the same lifted state), replacing the current standalone address field.

## 6. Geocoding proxy: `app/api/geocode/route.ts` + `app/api/reverse-geocode/route.ts` (new Route Handlers)

Both require `getCurrentUser()` to resolve non-null (401 otherwise) — this proxy has no per-request cost signal of its own to the caller, so gating it behind login prevents it becoming an open, unauthenticated relay that could exhaust this app's shared Nominatim usage allowance for every real user.

- `GET /api/geocode?q=<address text>` → forward-geocodes via Nominatim's `/search` endpoint (`format=jsonv2&limit=1&countrycodes=id`, restricting results to Indonesia to match this product's market), returns `{ address, latitude, longitude }` for the single best match or `{ error: 'NOT_FOUND' }` (404) if Nominatim returns zero results.
- `GET /api/reverse-geocode?lat=&lon=` → reverse-geocodes via Nominatim's `/reverse` endpoint, returns `{ address }` or `{ error: 'NOT_FOUND' }`.
- Both set a fixed, descriptive `User-Agent` header on the outbound Nominatim request (required by Nominatim's usage policy; the value itself — e.g. including a contact — is a plan-time detail, not a design decision), a 5-second timeout (`AbortSignal.timeout(5000)`), and pure input validation via a small Zod schema (non-empty `q`; `lat`/`lon` in valid range) before ever calling out. See §10 for throttling and failure-mode detail.

Response-parsing is factored into pure, unit-testable functions in a new `lib/geocode.ts` (`parseNominatimSearchResult`, `parseNominatimReverseResult`) — decoupled from the `fetch` call itself, matching this codebase's existing pattern of testing pure logic rather than network calls.

## 7. `components/map/map-display.tsx` (new, client component) — job detail

Wraps `BaseMap` with a single fixed, non-interactive marker at a given `latitude`/`longitude`. `app/(main)/jobs/[id]/page.tsx` renders it alongside (not instead of) the existing "Lihat Lokasi di Google Maps" outbound link — that link is still useful for actual turn-by-turn navigation, which this in-app map doesn't attempt to replace.

## 8. `components/map/jobs-map.tsx` (new, client component) — job browse map view

Wraps `BaseMap` with one marker per job in a `{ id, title, categoryName, paymentAmount, latitude, longitude }[]` array (a small projection of what `getJobListing` already returns — no new query). Each marker's popup shows title, payment amount, and a "Lihat Detail" link into `/jobs/[id]`. Auto-fits the map's bounds to the current marker set (Leaflet's `fitBounds`) so every visible pin is in view without manual zoom-hunting; falls back to an Indonesia-wide default center/zoom when the filtered list has zero or one job.

`app/(main)/jobs/page.tsx` gets a small List/Map toggle, a new client component (`components/map/... ` or colocated `view-toggle.tsx`) driven by a `?view=map` search param (consistent with how `job-filters.tsx` already encodes filter state in the URL — shareable, back-button-friendly). The server component still fetches `jobs` identically regardless of view; `view=map` renders `<JobsMap jobs={jobs} />` in place of the existing `<ul>` list, both still wrapped by the same `Suspense`-loaded `JobFilters`. Defaults to List view (mobile-first — PRD §40/§49).

## 9. Error handling

- **Geocoding failure or timeout** (Nominatim down/slow, or the proxy's own fetch throws): the route handler returns a typed error the `MapPicker` shows as a small inline message ("Gagal menghubungi layanan peta, coba lagi." for network/timeout, "Alamat tidak ditemukan, coba kata kunci lain atau klik langsung di peta." for a genuine zero-result search). This never blocks the rest of the form — the marker can still be placed by a direct map click (which needs no geocoding call at all) and the address text remains freely editable, so job creation/editing keeps working end-to-end even if the geocoding proxy is entirely unreachable.
- **Browser geolocation denied/unsupported**: same handled pattern `job-filters.tsx` already uses (inline Indonesian error message, no crash).
- **Route handler auth failure**: a 401 JSON body the client-side fetch turns into the same inline error message as any other geocoding failure — not a distinct UI state.
- **Nominatim throttling** (see §10): if a request is queued behind the 1-req/sec limit for more than the fetch's own timeout, it surfaces as the same timeout error above — no separate "rate limited" UI state, since from the picker's perspective it's indistinguishable from Nominatim itself being slow.

## 10. Rate limiting

A module-level `let lastRequestAt = 0` in the route handler enforces Nominatim's documented 1-request/second policy: before each outbound call, if less than 1000ms has elapsed since `lastRequestAt`, await the remainder before firing. This is best-effort per server instance, not a distributed/cross-instance guarantee (see §2 — out of scope) — acceptable given this app's single-Next.js-app, ~50-user deployment model; would need revisiting (e.g. a shared store) only if the app were ever horizontally scaled across multiple instances.

## 11. Testing

Unit-testable (new `lib/geocode.test.ts`, following this repo's existing pure-function-testing convention — see `lib/geo.test.ts`, `lib/upload-limits.test.ts`): `parseNominatimSearchResult`/`parseNominatimReverseResult`'s handling of a well-formed result, an empty-array result, and a malformed/unexpected response shape; the Zod schemas backing both route handlers' query params.

Not unit-tested: `react-leaflet` rendering itself — jsdom does not reliably render real tile/DOM layout, and this repo's own established practice for library-heavy UI (e.g. Phase 9's realtime chat) is genuine Playwright verification instead of forcing a rendering test. DoD verification for this phase must include, against the real running app:
- Job create: search an address in the picker → pin moves, lat/lng fields populate; drag the pin → address field updates; submit → the created job's stored `address`/`latitude`/`longitude` match what was shown.
- Job detail: map renders a pin at the correct location; Google Maps link still works.
- Job browse: toggle to Map view → pins appear only for the currently-filtered job set; clicking a pin's popup link navigates to that job's detail page.
- **Geocoding failure path** (easy to skip, must not be): with the geocode proxy temporarily broken (e.g. point it at an invalid host, or block the request), confirm the picker still allows placing a pin by direct map click and submitting the form successfully, with only the inline error shown — not a broken/stuck form.

## 12. Open assumptions

- Nominatim's public endpoint is used directly with a descriptive `User-Agent` and best-effort in-memory throttling — not a paid/dedicated geocoding provider. Sufficient for this MVP's ~50-user scale.
- Address text stays freely user-editable after any geocoding fill; geocoding only ever suggests a value, never overwrites without the user seeing it happen (they're actively typing or dragging when it fires).
- The three map components (`BaseMap`, `MapPicker`, `MapDisplay`) plus `JobsMap` are the complete new component set — no other page gets a map in this phase.
- Exact `leaflet/dist/leaflet.css` import placement and any Next 16-specific Route Handler/dynamic-import details are confirmed against `node_modules/next/dist/docs/` at plan/implementation time, per this repo's `AGENTS.md` (not assumed from general Next.js knowledge, since this pinned version may differ).
