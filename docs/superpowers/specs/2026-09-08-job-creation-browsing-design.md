# Job Creation & Browsing — Design

**Status:** Approved
**Date:** 2026-09-08
**Scope:** Phase 4 of PARUH WAKTU MVP — the first half of "Job Marketplace" (see `docs/PRD — PARUH WAKTU MVP.md` §9-14, and `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` STEP 5). Application/assignment (the second half of STEP 5) is a separate, later phase (Phase 5) by deliberate decomposition — this spec covers only: create a job, browse/search/filter, view job detail, and edit a still-open job.

## 1. Purpose

Let an approved employer (has the `employer` role, granted in Phase 3) create a job posting, and let any authenticated worker browse, search, filter, and view job details. This is the first feature phase to write to the `jobs` table at all.

## 2. Out of scope (explicitly deferred)

- Job application, applicant management, worker assignment (Phase 5).
- Job attachments (photo/video upload on a job posting) — PRD marks this optional ("jika diperlukan"); deferred, not needed for the core create/browse flow.
- Map picker / embedded map display (Leaflet + OpenStreetMap) — STEP 6 in the Implementation Prompt, a later phase. Job location is address text + plain numeric latitude/longitude inputs for now; the detail page shows a link to open the coordinates in Google Maps instead of an embedded map.
- Draft status / a separate "publish" step — `createJob` publishes directly to `status = 'open'`. The `draft` status value already exists in the schema's CHECK constraint and remains available for a future phase to use; nothing here removes it.
- Cancelling a job — no cancel action in this phase (nothing depends on it yet: no applications exist to cancel against).
- Admin job management (`/admin/jobs`) — arrives with whichever future phase needs it, per the established "minimal admin surface, grown per-feature" precedent from Phase 3.
- Persisting the worker's location to their profile — Phase 2 deliberately deferred collecting `profiles.latitude`/`longitude` until the Location phase; this phase does not change that. Distance-based filtering here uses a live, one-off browser geolocation read (never stored).

## 3. What already exists (Phase 1), reused as-is

- `public.jobs` (id, employer_id, category_id, title, description, address, latitude, longitude, payment_amount, duration_minutes, deadline, status, assigned_worker_id, cancelled_reason, timestamps). `status` CHECK includes the full lifecycle (`draft`, `open`, `assigned`, ... `payment_rejected`) — this phase only ever writes `'open'`.
- `public.job_categories` (id, name, is_active) — already seeded with 5 categories, admin-manageable (no admin UI yet, matching the "grown per-feature" admin precedent — not needed until an admin actually needs to add one).
- RLS: `jobs_select_open_or_involved_or_admin` (SELECT only — `status = 'open'` OR the caller's own `employer_id`/`assigned_worker_id` OR `is_admin()`). **No INSERT/UPDATE policy exists on `jobs` at all** — unlike Phase 3's `employer_verifications`, this table follows Phase 1's general rule (stated in its Global Constraints) that business-table writes go exclusively through a service-role DAL, never direct RLS-permitted writes from the browser client.
- `public.platform_settings` row `default_job_radius_km` (seeded `10`) — used as the default search radius.
- `lib/auth/get-current-user.ts`: `getCurrentUser()`, `requireRole(role)`, `hasRole()`.
- `lib/supabase/service.ts`: `createServiceClient()` (Phase 1/2's established pattern for tables with no direct-write RLS policy).
- `lib/errors.ts`: `appError`, `toSafeErrorMessage`.

## 4. Database changes

**None.** No new migration is needed for this phase — `jobs`/`job_categories` already exist with the right shape and the right (SELECT-only) RLS for this phase's needs. All writes go through the service-role client inside the DAL, matching Phase 1's established rule for this table (see §3) — this is a deliberate difference from Phase 3, not an oversight.

## 5. Application layer

### 5.1 Validation (`lib/validations/job.ts`)

`CreateJobSchema` (also reused for edit — see §5.2):
- `title`: `z.string().trim().min(5, ...)`.
- `categoryId`: `z.string().trim().uuid(...)` (existence + `is_active` are checked in the DAL against the live table, not re-encoded in Zod).
- `description`: `z.string().trim().min(20, ...)`.
- `address`: `z.string().trim().min(5, ...)`.
- `latitude`: `z.coerce.number().min(-90).max(90)`.
- `longitude`: `z.coerce.number().min(-180).max(180)`.
- `paymentAmount`: `z.coerce.number().positive(...)`.
- `durationMinutes`: `z.coerce.number().int().positive(...)`.
- `deadline`: `z.coerce.date().refine((d) => d.getTime() > Date.now(), { error: 'Deadline harus di masa depan.' })`.

### 5.2 Service layer (`lib/services/jobs.ts`)

All functions use `createServiceClient()` (per §3/§4 — this table has no client-writable RLS path).

- `createJob(input: CreateJobInput): Promise<{ id: string }>` — `requireRole('employer')` (this alone is the "approved employer" check: the `employer` role only exists on a user because Phase 3's `review_employer_verification()` granted it), re-validates via `CreateJobSchema.parse`, checks the category exists and `is_active = true` (else `appError('VALIDATION_ERROR', 'Kategori tidak valid.')`), inserts with `employer_id: user.id, status: 'open'`.
- `updateJob(jobId: string, input: CreateJobInput): Promise<void>` — `requireRole('employer')`, re-validates, loads the job, throws `appError('NOT_FOUND')` if missing, `appError('FORBIDDEN')` if `job.employer_id !== user.id`, `appError('CONFLICT', 'Pekerjaan yang sudah tidak berstatus "open" tidak dapat diedit.')` if `job.status !== 'open'`, then updates the same field set `createJob` writes (never `status`, `employer_id`, or `assigned_worker_id` — no mass assignment).
- `getOwnJobs(): Promise<JobSummary[]>` — `requireRole('employer')`, returns the caller's own jobs (any status), newest first — this is how an employer finds a job to edit.
- `getJobListing(filters: JobListingFilters): Promise<JobListing[]>` — `getCurrentUser()` (any authenticated role may browse), queries `status = 'open'` plus optional `keyword` (`ilike` on `title`), `categoryId` (exact match), `minPayment`/`maxPayment` (range on `payment_amount`); if `filters.workerLat`/`filters.workerLng` are provided, computes Haversine distance to each row in application code (no PostGIS/geo SQL — YAGNI at this data volume) and filters to `filters.radiusKm` (defaulting to `platform_settings.default_job_radius_km`), sorting by distance ascending; without coordinates, sorts by `created_at desc`.
- `getJobDetail(jobId: string): Promise<JobDetail | null>` — `getCurrentUser()`, loads the row, and **replicates the RLS predicate manually** (`status === 'open' || job.employer_id === user.id || job.assigned_worker_id === user.id || hasRole('admin')`) before returning it — since the service-role client bypasses RLS entirely, the DAL itself must be the enforcement point here, or any authenticated user could view any draft/cancelled job by guessing its UUID. Returns `null` (→ page renders `notFound()`) rather than throwing, for both "doesn't exist" and "exists but not visible to this caller" — never distinguish the two in the response, so a probing request can't learn which case it hit.

### 5.3 Routes

- `app/jobs/page.tsx` — browse/search/filter (Server Component reading `searchParams` for `keyword`/`category`/`minPayment`/`maxPayment`/`radiusKm`; a client component handles requesting `navigator.geolocation.getCurrentPosition` and re-navigating with `lat`/`lng` query params added, since geolocation is a browser API unavailable in a Server Component).
- `app/jobs/[id]/page.tsx` — detail page; `notFound()` when `getJobDetail` returns `null`. Shows a `https://www.google.com/maps?q={lat},{lng}` link instead of an embedded map.
- `app/jobs/new/page.tsx` + `app/jobs/actions.ts` (`createJobAction`) — create form. If the current user lacks the `employer` role, render an inline message ("Anda harus terverifikasi sebagai Pemberi Kerja terlebih dahulu") with a link to `/verification` **instead of** the form — not a hard `notFound()`/404 like the admin guard, since this is a normal, expected dead-end for a legitimate role a worker might not have yet (unlike `/admin`, which is deliberately hidden from anyone not authorized to know it exists).
- `app/jobs/[id]/edit/page.tsx` + `app/jobs/actions.ts` (`updateJobAction`, alongside `createJobAction` in the same file, mirroring `app/auth/actions.ts` holding both `registerAction` and `loginAction`) — shares a `<JobForm>` client component with the create page (same fields; `defaultValues` populated for edit, empty for create).
- `app/jobs/mine/page.tsx` — employer's own job list, each row linking to `/jobs/[id]/edit` when `status === 'open'`.
- `app/profile/page.tsx` gets a small addition: a link to `/jobs` (browse) and, only when the user already has the `employer` role, a link to `/jobs/new` — mirroring Phase 3's one-line addition of the `/verification` link.

## 6. Error handling

Reuses `lib/errors.ts` as-is. `FORBIDDEN` for editing someone else's job; `CONFLICT` for editing a non-`open` job; `VALIDATION_ERROR` for an inactive/nonexistent category; `NOT_FOUND` (surfaced as `notFound()`, not a message) for a job detail request that doesn't exist or isn't visible.

## 7. Testing

- Unit tests for `CreateJobSchema` (deadline-in-the-past rejection, lat/lng range validation, positive-number coercion) mirroring the existing `lib/validations/*.test.ts` style.
- Unit tests for the Haversine distance/sort/filter logic in `getJobListing` — this is genuine, non-trivial, pure-ish logic worth isolating and testing directly (extract it as a small testable helper, e.g. `haversineDistanceKm(a, b)`, rather than only testing it indirectly through the full DB-backed function).
- Manual end-to-end verification (mirrors Phase 2/3's pattern, since RLS/DAL-visibility behavior needs a live Supabase connection): create a job as an approved employer → confirm it's `open` and visible to a different worker account on `/jobs` → search/filter/keyword narrows results correctly → edit it while `open` → confirm changes persist → confirm a non-employer visiting `/jobs/new` sees the verification prompt, not the form → confirm a worker cannot edit someone else's job (direct action call) → confirm `getJobDetail` on a nonexistent/invisible id renders `notFound()`.

## 8. Open assumptions (per PRD §58 — safest MVP default, documented, revisit later)

- `requireRole('employer')` is treated as sufficient proof of "approved employer" — correct today because the only way to gain that role is Phase 3's admin-approval RPC, but if a future phase ever adds another path to the `employer` role, this assumption must be revisited.
- Distance filtering uses a live, unstored geolocation read on every visit to `/jobs`; a worker who denies the browser permission prompt simply sees results unsorted/unfiltered by distance (falls back to `created_at desc`), never a hard error.
- Editing is allowed only while `status = 'open'` — once a job has any assignment activity (even in a later phase), it becomes immutable via this edit path, matching PRD's implicit assumption that a job's terms are locked once someone is relying on them.
