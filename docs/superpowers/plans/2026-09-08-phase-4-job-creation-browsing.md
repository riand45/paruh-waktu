# Phase 4 — Job Creation & Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved employer create and edit a job posting, and let any authenticated worker browse, search, filter (including distance from a live browser-geolocation read), and view job details.

**Architecture:** Unlike Phase 3's `employer_verifications` (which got a direct RLS `INSERT` policy), the `jobs` table has **only a `SELECT` RLS policy** — Phase 1's Global Constraints mandate that every other write on this table goes exclusively through a service-role Data Access Layer, matching Phase 2's `profiles.ts` pattern. `lib/services/jobs.ts` is therefore the only place that writes to `jobs`, and it must independently re-derive the same visibility rule the RLS policy encodes (`open`, or the caller's own job, or admin) whenever it reads a single job by id — since the service-role client bypasses RLS entirely, skipping this check would let any authenticated user view any draft/cancelled job by guessing its UUID.

**Tech Stack:** Next.js 16 (Server Actions, `useActionState`, native `<form>`, `useSearchParams` for client-side filter state), Zod v4, Supabase (service-role client for all `jobs` writes), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-job-creation-browsing-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §9-14, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` STEP 5, and this repo's Phase 1-3 plans for schema and conventions this phase builds on.

## Global Constraints

- Every write to `jobs` goes through `lib/services/jobs.ts` using `createServiceClient()` (Phase 1/2's service-role pattern) — there is no RLS `INSERT`/`UPDATE` policy on `jobs` to fall back on, unlike Phase 3's `employer_verifications`.
- `getJobDetail` must manually replicate the `jobs_select_open_or_involved_or_admin` RLS predicate (`status = 'open'` OR caller is the employer OR caller is the assigned worker OR caller is admin) before returning a row, and must return `null` (not throw) for both "doesn't exist" and "exists but not visible" — never let a caller distinguish the two.
- `requireRole('employer')` is treated as sufficient proof of an approved employer — the only way to hold that role is Phase 3's admin-approval RPC.
- A job is only editable while `status = 'open'`; `updateJob` throws `appError('CONFLICT', ...)` otherwise, and never accepts writes to `status`, `employer_id`, or `assigned_worker_id`.
- Distance filtering uses a one-off `navigator.geolocation` read triggered by the user (never automatic on page load, and never persisted to the worker's profile) — Phase 2 deliberately deferred collecting `profiles.latitude`/`longitude` until the Location phase, and this phase does not change that.
- The Haversine distance calculation is plain application-code math (`lib/geo.ts`), not a PostGIS/SQL geo function — appropriate for this app's data volume (~50 users) per YAGNI.
- Zod schemas trim before validating name are consistent with Phase 2/3's fix (`.trim()` before `.min()`/regex, not after) — apply the same ordering here for every string field.
- No embedded map component in this phase (Leaflet/OpenStreetMap is STEP 6, a later phase) — the job detail page links out to Google Maps instead (`https://www.google.com/maps?q={lat},{lng}`).
- `app/jobs/new` shows an inline "become an employer" prompt with a link to `/verification` for a non-employer, not a hard `notFound()`/404 — this is a normal, expected dead-end for a legitimate role a worker might not have yet, unlike `/admin`'s deliberately-hidden guard.
- Every Server Action re-verifies authentication/authorization inside itself (via the service layer) — never rely on `proxy.ts`'s redirect alone.

---

### Task 1: Validation schema (Zod) for the job form

**Files:**
- Create: `lib/validations/job.ts`
- Create: `lib/validations/job.test.ts`

**Interfaces:**
- Produces: `CreateJobSchema`, `CreateJobInput` (type), `JobFormState` — consumed by Task 3 (service layer) and Task 4 (Server Actions + form).

- [ ] **Step 1: Write the failing tests**

Create `lib/validations/job.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/validations/job.test.ts
```

Expected: FAIL — `Cannot find module './job'`.

- [ ] **Step 3: Implement the schema**

Create `lib/validations/job.ts`:

```ts
import { z } from 'zod'

export const CreateJobSchema = z.object({
  title: z.string().trim().min(5, { error: 'Judul minimal 5 karakter.' }),
  categoryId: z.string().trim().uuid({ error: 'Kategori tidak valid.' }),
  description: z.string().trim().min(20, { error: 'Deskripsi minimal 20 karakter.' }),
  address: z.string().trim().min(5, { error: 'Alamat minimal 5 karakter.' }),
  latitude: z.coerce
    .number()
    .min(-90, { error: 'Latitude tidak valid.' })
    .max(90, { error: 'Latitude tidak valid.' }),
  longitude: z.coerce
    .number()
    .min(-180, { error: 'Longitude tidak valid.' })
    .max(180, { error: 'Longitude tidak valid.' }),
  paymentAmount: z.coerce.number().positive({ error: 'Nominal pembayaran harus lebih dari 0.' }),
  durationMinutes: z.coerce
    .number()
    .int({ error: 'Durasi harus bilangan bulat.' })
    .positive({ error: 'Durasi harus lebih dari 0.' }),
  deadline: z.coerce
    .date({ error: 'Deadline tidak valid.' })
    .refine((d) => d.getTime() > Date.now(), { error: 'Deadline harus di masa depan.' }),
})

export type CreateJobInput = z.infer<typeof CreateJobSchema>

export type JobFormState =
  | {
      errors?: {
        title?: string[]
        categoryId?: string[]
        description?: string[]
        address?: string[]
        latitude?: string[]
        longitude?: string[]
        paymentAmount?: string[]
        durationMinutes?: string[]
        deadline?: string[]
      }
      message?: string
    }
  | undefined
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/job.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validations
git commit -m "feat: add Zod validation schema for job creation"
```

---

### Task 2: Haversine distance helper

**Files:**
- Create: `lib/geo.ts`
- Create: `lib/geo.test.ts`

**Interfaces:**
- Produces: `Coordinates` (interface: `{ latitude: number; longitude: number }`), `haversineDistanceKm(a: Coordinates, b: Coordinates): number` — consumed by Task 3's `getJobListing`.

- [ ] **Step 1: Write the failing tests**

Create `lib/geo.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/geo.test.ts
```

Expected: FAIL — `Cannot find module './geo'`.

- [ ] **Step 3: Implement the helper**

Create `lib/geo.ts`:

```ts
export interface Coordinates {
  latitude: number
  longitude: number
}

const EARTH_RADIUS_KM = 6371

export function haversineDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180

  const deltaLat = toRadians(b.latitude - a.latitude)
  const deltaLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)

  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/geo.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/geo.ts lib/geo.test.ts
git commit -m "feat: add Haversine distance helper"
```

---

### Task 3: Job service layer

**Files:**
- Create: `lib/services/jobs.ts`

**Interfaces:**
- Produces: `JobSummary`, `JobListingFilters`, `JobListing`, `JobDetail` (interfaces); `createJob(input)`, `updateJob(jobId, input)`, `getOwnJobs()`, `getJobListing(filters)`, `getJobDetail(jobId)` — consumed by Task 4 (create/edit actions), Task 5 (listing page), Task 6 (detail page), Task 7 (my-jobs page).
- Consumes: `requireRole`, `getCurrentUser` (Phase 1's `lib/auth/get-current-user.ts`), `hasRole` (Phase 1's `lib/auth/has-role.ts`), `createServiceClient` (Phase 1's `lib/supabase/service.ts`), `appError` (Phase 1's `lib/errors.ts`), `CreateJobSchema`, `CreateJobInput` (Task 1), `haversineDistanceKm` (Task 2).

- [ ] **Step 1: Write the service layer**

Create `lib/services/jobs.ts`:

```ts
import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { hasRole } from '@/lib/auth/has-role'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { CreateJobSchema, type CreateJobInput } from '@/lib/validations/job'
import { haversineDistanceKm } from '@/lib/geo'

type ServiceClient = ReturnType<typeof createServiceClient>

async function assertActiveCategory(supabase: ServiceClient, categoryId: string): Promise<void> {
  const { data, error } = await supabase
    .from('job_categories')
    .select('id, is_active')
    .eq('id', categoryId)
    .maybeSingle()

  if (error || !data || !data.is_active) {
    throw appError('VALIDATION_ERROR', 'Kategori tidak valid.')
  }
}

export async function createJob(input: CreateJobInput): Promise<{ id: string }> {
  const user = await requireRole('employer')
  const validated = CreateJobSchema.parse(input)

  const supabase = createServiceClient()
  await assertActiveCategory(supabase, validated.categoryId)

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      employer_id: user.id,
      category_id: validated.categoryId,
      title: validated.title,
      description: validated.description,
      address: validated.address,
      latitude: validated.latitude,
      longitude: validated.longitude,
      payment_amount: validated.paymentAmount,
      duration_minutes: validated.durationMinutes,
      deadline: validated.deadline.toISOString(),
      status: 'open',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw appError('INTERNAL_ERROR')
  }

  return { id: data.id }
}

export async function updateJob(jobId: string, input: CreateJobInput): Promise<void> {
  const user = await requireRole('employer')
  const validated = CreateJobSchema.parse(input)

  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }
  if (job.status !== 'open') {
    throw appError('CONFLICT', 'Pekerjaan yang sudah tidak berstatus "open" tidak dapat diedit.')
  }

  await assertActiveCategory(supabase, validated.categoryId)

  const { error } = await supabase
    .from('jobs')
    .update({
      category_id: validated.categoryId,
      title: validated.title,
      description: validated.description,
      address: validated.address,
      latitude: validated.latitude,
      longitude: validated.longitude,
      payment_amount: validated.paymentAmount,
      duration_minutes: validated.durationMinutes,
      deadline: validated.deadline.toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
}

export interface JobSummary {
  id: string
  title: string
  categoryId: string
  status: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  createdAt: string
}

export async function getOwnJobs(): Promise<JobSummary[]> {
  const user = await requireRole('employer')
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('jobs')
    .select('id, title, category_id, status, payment_amount, duration_minutes, deadline, created_at')
    .eq('employer_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map((job) => ({
    id: job.id,
    title: job.title,
    categoryId: job.category_id,
    status: job.status,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    createdAt: job.created_at,
  }))
}

export interface JobListingFilters {
  keyword?: string
  categoryId?: string
  minPayment?: number
  maxPayment?: number
  workerLat?: number
  workerLng?: number
  radiusKm?: number
}

export interface JobListing {
  id: string
  title: string
  categoryId: string
  address: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  distanceKm: number | null
}

async function getDefaultJobRadiusKm(supabase: ServiceClient): Promise<number> {
  const { data } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'default_job_radius_km')
    .maybeSingle()

  return typeof data?.value === 'number' ? data.value : 10
}

export async function getJobListing(filters: JobListingFilters): Promise<JobListing[]> {
  await getCurrentUser()
  const supabase = createServiceClient()

  let query = supabase
    .from('jobs')
    .select(
      'id, title, category_id, address, latitude, longitude, payment_amount, duration_minutes, deadline, created_at'
    )
    .eq('status', 'open')

  if (filters.keyword) {
    query = query.ilike('title', `%${filters.keyword}%`)
  }
  if (filters.categoryId) {
    query = query.eq('category_id', filters.categoryId)
  }
  if (filters.minPayment !== undefined) {
    query = query.gte('payment_amount', filters.minPayment)
  }
  if (filters.maxPayment !== undefined) {
    query = query.lte('payment_amount', filters.maxPayment)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = data ?? []
  const hasLocation = filters.workerLat !== undefined && filters.workerLng !== undefined

  let jobs: JobListing[] = rows.map((job) => ({
    id: job.id,
    title: job.title,
    categoryId: job.category_id,
    address: job.address,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    distanceKm: hasLocation
      ? haversineDistanceKm(
          { latitude: filters.workerLat as number, longitude: filters.workerLng as number },
          { latitude: job.latitude, longitude: job.longitude }
        )
      : null,
  }))

  if (hasLocation) {
    const radiusKm = filters.radiusKm ?? (await getDefaultJobRadiusKm(supabase))
    jobs = jobs
      .filter((job) => job.distanceKm !== null && job.distanceKm <= radiusKm)
      .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
  }

  return jobs
}

export interface JobDetail {
  id: string
  title: string
  description: string
  address: string
  latitude: number
  longitude: number
  categoryId: string
  paymentAmount: number
  durationMinutes: number
  deadline: string
  status: string
  employerId: string
}

export async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const supabase = createServiceClient()
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      'id, title, description, address, latitude, longitude, category_id, payment_amount, duration_minutes, deadline, status, employer_id, assigned_worker_id'
    )
    .eq('id', jobId)
    .maybeSingle()

  if (error || !job) {
    return null
  }

  const isVisible =
    job.status === 'open' ||
    job.employer_id === user.id ||
    job.assigned_worker_id === user.id ||
    hasRole(user.roles.map((role) => ({ role })), 'admin')

  if (!isVisible) {
    return null
  }

  return {
    id: job.id,
    title: job.title,
    description: job.description,
    address: job.address,
    latitude: job.latitude,
    longitude: job.longitude,
    categoryId: job.category_id,
    paymentAmount: job.payment_amount,
    durationMinutes: job.duration_minutes,
    deadline: job.deadline,
    status: job.status,
    employerId: job.employer_id,
  }
}
```

Note: `assertActiveCategory` is a private (non-exported) helper shared by `createJob` and `updateJob` — both need the identical "category exists and is active" check, so it's factored out rather than duplicated (DRY).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. (No UI consumes this yet — that's Tasks 4-7. Like Phase 2/3's DB-backed services, this has no automated test here because every path needs a real authenticated session and a real Supabase connection; it's exercised end-to-end once the UI exists, verified manually in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add lib/services
git commit -m "feat(jobs): add job service layer"
```

---

### Task 4: Create and edit job pages

**Files:**
- Create: `app/jobs/actions.ts`
- Create: `app/jobs/job-form.tsx`
- Create: `app/jobs/new/page.tsx`
- Create: `app/jobs/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `createJob`, `updateJob` (Task 3); `CreateJobSchema`, `JobFormState` (Task 1); `toSafeErrorMessage` (Phase 1's `lib/errors.ts`); `getCurrentUser` (Phase 1); `createClient` (Phase 1's `lib/supabase/server.ts`, for reading `job_categories` and, in the edit page, the job being edited).
- Produces: `createJobAction(prevState, formData)`, `updateJobAction(jobId, prevState, formData)` — the latter is called via `.bind(null, jobId)` from the edit page before being passed to `useActionState`. `JobForm` (shared client component), used only by this task's two pages (`app/jobs/new/page.tsx` and `app/jobs/[id]/edit/page.tsx`) — Task 5's listing page does not use it.

Before writing `app/jobs/[id]/edit/page.tsx`, check `node_modules/next/dist/docs/` for this Next.js version's exact dynamic route `params` shape (confirmed elsewhere in this repo to be `params: Promise<{ id: string }>` — verify this still holds rather than assuming).

- [ ] **Step 1: Create the Server Actions**

Create `app/jobs/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createJob, updateJob } from '@/lib/services/jobs'
import { CreateJobSchema, type JobFormState } from '@/lib/validations/job'
import { toSafeErrorMessage } from '@/lib/errors'

function parseJobFormData(formData: FormData) {
  return {
    title: formData.get('title'),
    categoryId: formData.get('categoryId'),
    description: formData.get('description'),
    address: formData.get('address'),
    latitude: formData.get('latitude'),
    longitude: formData.get('longitude'),
    paymentAmount: formData.get('paymentAmount'),
    durationMinutes: formData.get('durationMinutes'),
    deadline: formData.get('deadline'),
  }
}

export async function createJobAction(
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  const validatedFields = CreateJobSchema.safeParse(parseJobFormData(formData))

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  let jobId: string
  try {
    const result = await createJob(validatedFields.data)
    jobId = result.id
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/jobs')
  revalidatePath('/jobs/mine')
  redirect(`/jobs/${jobId}`)
}

export async function updateJobAction(
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  const validatedFields = CreateJobSchema.safeParse(parseJobFormData(formData))

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await updateJob(jobId, validatedFields.data)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/jobs')
  revalidatePath('/jobs/mine')
  revalidatePath(`/jobs/${jobId}`)
  redirect(`/jobs/${jobId}`)
}
```

Note: `redirect()` throws internally by design — do not wrap it in `try`/`catch` (both `try` blocks above end before the `redirect()` call, not around it).

- [ ] **Step 2: Create the shared job form (client component)**

Create `app/jobs/job-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import type { JobFormState } from '@/lib/validations/job'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface JobCategoryOption {
  id: string
  name: string
}

interface JobFormDefaultValues {
  title: string
  categoryId: string
  description: string
  address: string
  latitude: string
  longitude: string
  paymentAmount: string
  durationMinutes: string
  deadline: string
}

export function JobForm({
  action,
  categories,
  defaultValues,
  submitLabel,
}: {
  action: (prevState: JobFormState, formData: FormData) => Promise<JobFormState>
  categories: JobCategoryOption[]
  defaultValues?: JobFormDefaultValues
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Judul Pekerjaan</Label>
        <Input id="title" name="title" defaultValue={defaultValues?.title} required />
        {state?.errors?.title && (
          <p className="text-sm text-destructive">{state.errors.title[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryId">Kategori</Label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={defaultValues?.categoryId ?? ''}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          required
        >
          <option value="" disabled>
            Pilih kategori
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {state?.errors?.categoryId && (
          <p className="text-sm text-destructive">{state.errors.categoryId[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Deskripsi</Label>
        <textarea
          id="description"
          name="description"
          defaultValue={defaultValues?.description}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          rows={4}
          required
        />
        {state?.errors?.description && (
          <p className="text-sm text-destructive">{state.errors.description[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Alamat</Label>
        <Input id="address" name="address" defaultValue={defaultValues?.address} required />
        {state?.errors?.address && (
          <p className="text-sm text-destructive">{state.errors.address[0]}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="latitude">Latitude</Label>
          <Input
            id="latitude"
            name="latitude"
            type="number"
            step="any"
            defaultValue={defaultValues?.latitude}
            required
          />
          {state?.errors?.latitude && (
            <p className="text-sm text-destructive">{state.errors.latitude[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="longitude">Longitude</Label>
          <Input
            id="longitude"
            name="longitude"
            type="number"
            step="any"
            defaultValue={defaultValues?.longitude}
            required
          />
          {state?.errors?.longitude && (
            <p className="text-sm text-destructive">{state.errors.longitude[0]}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="paymentAmount">Nominal Pembayaran (Rp)</Label>
        <Input
          id="paymentAmount"
          name="paymentAmount"
          type="number"
          step="any"
          defaultValue={defaultValues?.paymentAmount}
          required
        />
        {state?.errors?.paymentAmount && (
          <p className="text-sm text-destructive">{state.errors.paymentAmount[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="durationMinutes">Durasi (menit)</Label>
        <Input
          id="durationMinutes"
          name="durationMinutes"
          type="number"
          defaultValue={defaultValues?.durationMinutes}
          required
        />
        {state?.errors?.durationMinutes && (
          <p className="text-sm text-destructive">{state.errors.durationMinutes[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deadline">Deadline</Label>
        <Input
          id="deadline"
          name="deadline"
          type="datetime-local"
          defaultValue={defaultValues?.deadline}
          required
        />
        {state?.errors?.deadline && (
          <p className="text-sm text-destructive">{state.errors.deadline[0]}</p>
        )}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan...' : submitLabel}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the "new job" page**

Create `app/jobs/new/page.tsx`:

```tsx
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createJobAction } from '../actions'
import { JobForm } from '../job-form'

export default async function NewJobPage() {
  const user = await getCurrentUser()

  if (!user || !user.roles.includes('employer')) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Anda harus terverifikasi sebagai Pemberi Kerja terlebih dahulu.
        </p>
        <Link
          href="/verification"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Ajukan Verifikasi
        </Link>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: categories } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Buat Pekerjaan</h1>
      <JobForm action={createJobAction} categories={categories ?? []} submitLabel="Publikasikan" />
    </div>
  )
}
```

- [ ] **Step 4: Create the "edit job" page**

Create `app/jobs/[id]/edit/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { updateJobAction } from '../../actions'
import { JobForm } from '../../job-form'

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const supabase = await createClient()
  const { data: job } = await supabase
    .from('jobs')
    .select(
      'id, title, category_id, description, address, latitude, longitude, payment_amount, duration_minutes, deadline, status, employer_id'
    )
    .eq('id', id)
    .maybeSingle()

  if (!job || job.employer_id !== user.id || job.status !== 'open') {
    notFound()
  }

  const { data: categories } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  const boundUpdateAction = updateJobAction.bind(null, job.id)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Edit Pekerjaan</h1>
      <JobForm
        action={boundUpdateAction}
        categories={categories ?? []}
        submitLabel="Simpan Perubahan"
        defaultValues={{
          title: job.title,
          categoryId: job.category_id,
          description: job.description,
          address: job.address,
          latitude: String(job.latitude),
          longitude: String(job.longitude),
          paymentAmount: String(job.payment_amount),
          durationMinutes: String(job.duration_minutes),
          deadline: new Date(job.deadline).toISOString().slice(0, 16),
        }}
      />
    </div>
  )
}
```

Note: this page reads the job via the regular authenticated client (`createClient()`), not the service-role client — it's only used to pre-fill the form for the job's own employer, and `jobs_select_open_or_involved_or_admin`'s RLS already grants that employer visibility into their own row regardless of status.

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add app/jobs
git commit -m "feat(jobs): add create and edit job pages"
```

---

### Task 5: Job listing page (browse, search, filter, distance)

**Files:**
- Create: `app/jobs/page.tsx`
- Create: `app/jobs/job-filters.tsx`

**Interfaces:**
- Consumes: `getJobListing`, `JobListing` (Task 3); `createClient` (Phase 1, for reading `job_categories`).

Before writing `app/jobs/page.tsx`, check `node_modules/next/dist/docs/` for this Next.js version's exact `searchParams` shape on a page component (expected: `searchParams: Promise<Record<string, string | string[] | undefined>>`, same async-prop pattern as dynamic route `params` — verify rather than assume) and for `useSearchParams`'s Suspense guidance (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md` recommends wrapping any Client Component that calls `useSearchParams` in a `<Suspense>` boundary).

- [ ] **Step 1: Create the filter controls (client component)**

Create `app/jobs/job-filters.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function JobFilters({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [keyword, setKeyword] = useState(searchParams.get('keyword') ?? '')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [minPayment, setMinPayment] = useState(searchParams.get('minPayment') ?? '')
  const [maxPayment, setMaxPayment] = useState(searchParams.get('maxPayment') ?? '')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  function applyFilters(extra?: Record<string, string>) {
    const params = new URLSearchParams()
    if (keyword) params.set('keyword', keyword)
    if (category) params.set('category', category)
    if (minPayment) params.set('minPayment', minPayment)
    if (maxPayment) params.set('maxPayment', maxPayment)

    const existingLat = searchParams.get('lat')
    const existingLng = searchParams.get('lng')
    if (existingLat) params.set('lat', existingLat)
    if (existingLng) params.set('lng', existingLng)

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        params.set(key, value)
      }
    }

    router.push(`/jobs?${params.toString()}`)
  }

  function handleNearMe() {
    setLocationError(null)
    if (!navigator.geolocation) {
      setLocationError('Browser Anda tidak mendukung deteksi lokasi.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        applyFilters({
          lat: String(position.coords.latitude),
          lng: String(position.coords.longitude),
        })
      },
      () => {
        setLocating(false)
        setLocationError('Izin lokasi ditolak atau gagal mendeteksi lokasi.')
      }
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Cari judul pekerjaan..."
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <select
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">Semua Kategori</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          placeholder="Nominal min"
          value={minPayment}
          onChange={(event) => setMinPayment(event.target.value)}
        />
        <Input
          type="number"
          placeholder="Nominal maks"
          value={maxPayment}
          onChange={(event) => setMaxPayment(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => applyFilters()}>
          Terapkan Filter
        </Button>
        <Button type="button" variant="outline" onClick={handleNearMe} disabled={locating}>
          {locating ? 'Mendeteksi...' : 'Terdekat'}
        </Button>
      </div>
      {locationError && <p className="text-sm text-destructive">{locationError}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Create the listing page (server component)**

Create `app/jobs/page.tsx`:

```tsx
import { Suspense } from 'react'
import Link from 'next/link'
import { getJobListing } from '@/lib/services/jobs'
import { createClient } from '@/lib/supabase/server'
import { JobFilters } from './job-filters'

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: categories } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  const jobs = await getJobListing({
    keyword: params.keyword || undefined,
    categoryId: params.category || undefined,
    minPayment: params.minPayment ? Number(params.minPayment) : undefined,
    maxPayment: params.maxPayment ? Number(params.maxPayment) : undefined,
    workerLat: params.lat ? Number(params.lat) : undefined,
    workerLng: params.lng ? Number(params.lng) : undefined,
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Cari Pekerjaan</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <JobFilters categories={categories ?? []} />
      </Suspense>
      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada pekerjaan ditemukan.</p>
      )}
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
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add app/jobs
git commit -m "feat(jobs): add job listing page with search, filter, and distance"
```

---

### Task 6: Job detail page

**Files:**
- Create: `app/jobs/[id]/page.tsx`

**Interfaces:**
- Consumes: `getJobDetail`, `JobDetail` (Task 3); `getCurrentUser` (Phase 1).

- [ ] **Step 1: Create the detail page**

Create `app/jobs/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getJobDetail } from '@/lib/services/jobs'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const job = await getJobDetail(id)

  if (!job) {
    notFound()
  }

  const user = await getCurrentUser()
  const isOwner = user?.id === job.employerId
  const mapsUrl = `https://www.google.com/maps?q=${job.latitude},${job.longitude}`

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">{job.title}</h1>
      <p className="text-sm text-muted-foreground">{job.description}</p>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Alamat</dt>
          <dd>{job.address}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nominal Pembayaran</dt>
          <dd>Rp{job.paymentAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Durasi</dt>
          <dd>{job.durationMinutes} menit</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Deadline</dt>
          <dd>{new Date(job.deadline).toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
      </dl>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Lihat Lokasi di Google Maps
      </a>
      {isOwner && job.status === 'open' && (
        <Link
          href={`/jobs/${job.id}/edit`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Edit Pekerjaan
        </Link>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add app/jobs
git commit -m "feat(jobs): add job detail page"
```

---

### Task 7: "My Jobs" page and profile page links

**Files:**
- Create: `app/jobs/mine/page.tsx`
- Modify: `app/profile/page.tsx` (add links to `/jobs`, and to `/jobs/new` + `/jobs/mine` when the user has the `employer` role)

**Interfaces:**
- Consumes: `getOwnJobs`, `JobSummary` (Task 3); `getCurrentUser`, `hasRole` (Phase 1).

- [ ] **Step 1: Create the "My Jobs" page**

Create `app/jobs/mine/page.tsx`:

```tsx
import Link from 'next/link'
import { getOwnJobs } from '@/lib/services/jobs'

export default async function MyJobsPage() {
  const jobs = await getOwnJobs()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pekerjaan Saya</h1>
      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">Anda belum membuat pekerjaan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={job.status === 'open' ? `/jobs/${job.id}/edit` : `/jobs/${job.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span>{job.title}</span>
              <span className="text-muted-foreground">{job.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Link to the job pages from the profile page**

Read `app/profile/page.tsx` first to see its current exact content (it already imports `getOwnProfile`, `logoutAction`, `AvatarUploader`, `ProfileForm`, and has a `Link` to `/verification` from Phase 3) before editing — the snippet below shows the changes to make, not the whole file.

Add these imports:

```tsx
import { getCurrentUser } from '@/lib/auth/get-current-user'
```

Inside the component, before the `return`, fetch the current user's roles:

```tsx
const currentUser = await getCurrentUser()
const isEmployer = currentUser?.roles.includes('employer') ?? false
```

Add these links in the JSX, alongside the existing `/verification` link:

```tsx
<Link href="/jobs" className="text-sm text-primary underline-offset-4 hover:underline">
  Cari Pekerjaan
</Link>
{isEmployer && (
  <>
    <Link href="/jobs/new" className="text-sm text-primary underline-offset-4 hover:underline">
      Buat Pekerjaan
    </Link>
    <Link href="/jobs/mine" className="text-sm text-primary underline-offset-4 hover:underline">
      Pekerjaan Saya
    </Link>
  </>
)}
```

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add app/jobs app/profile
git commit -m "feat(jobs): add my-jobs page and profile navigation links"
```

---

### Task 8: Phase 4 Definition-of-Done verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be Phase 3's 38 + Task 1's 9 + Task 2's 4 = 51.

- [ ] **Step 2: Create two throwaway test accounts**

Run as a one-off Node script from the repo root (do not commit it) — one approved-employer account (grant the `employer` role the same way Phase 3's admin was granted — a direct service-role insert into `user_roles`, not a schema change) and one plain worker:

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
async function main() {
  const { data: employer } = await supabase.auth.admin.createUser({
    email: 'phase4-employer@example.com',
    password: 'password1',
    email_confirm: true,
    user_metadata: { full_name: 'Phase 4 Employer', phone: '081200000004' },
  });
  await supabase.from('user_roles').upsert(
    { user_id: employer.user.id, role: 'employer' },
    { onConflict: 'user_id,role', ignoreDuplicates: true }
  );
  const { data: worker } = await supabase.auth.admin.createUser({
    email: 'phase4-worker@example.com',
    password: 'password1',
    email_confirm: true,
    user_metadata: { full_name: 'Phase 4 Worker', phone: '081200000005' },
  });
  console.log('employer:', employer.user.id);
  console.log('worker:', worker.user.id);
}
main();
"
```

- [ ] **Step 3: Verify the full flow in a real browser**

```bash
npm run dev
```

Using a real browser:
1. Log in as `phase4-employer@example.com` / `password1`, visit `/jobs/new` — confirm the form appears (not the "become an employer" prompt).
2. Submit a job with valid data — confirm redirect to `/jobs/[id]` and the job's data displays correctly, with a working "Lihat Lokasi di Google Maps" link.
3. Visit `/jobs/mine` — confirm the new job appears with status `open`.
4. Click "Edit Pekerjaan" from the detail page (or `/jobs/mine`), change the title, save — confirm the change persists and you're redirected back to the detail page.
5. Log out, log in as `phase4-worker@example.com` / `password1`, visit `/jobs/new` — confirm you see the "Anda harus terverifikasi..." message with a working link to `/verification`, not the form.
6. Visit `/jobs` — confirm the employer's job appears in the listing.
7. Use the keyword search, category filter, and min/max payment filters — confirm each narrows the results correctly.
8. Click "Terdekat" — confirm the browser's location permission prompt appears, and after granting it, the job list re-sorts/filters with a distance shown per job.
9. Click into the job from the listing — confirm the detail page shows correctly and that the "Edit Pekerjaan" link does NOT appear (this worker doesn't own the job).
10. As the worker, attempt to call `updateJobAction` for the employer's job directly (e.g. via browser devtools console invoking the bound action, or by visiting `/jobs/[id]/edit` directly) — confirm it's rejected (`notFound()` for the page visit, since the ownership check in `app/jobs/[id]/edit/page.tsx` fails).
11. As the employer, create a second job, then manually change its `status` away from `'open'` via a one-off script (service-role update) and confirm `/jobs/[that-id]/edit` now 404s (edit is blocked once not `open`) and the job no longer appears on `/jobs` (only `open` jobs list) but still appears on `/jobs/mine`.

- [ ] **Step 4: Clean up the test accounts and jobs**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
async function main() {
  const { data } = await supabase.auth.admin.listUsers();
  for (const email of ['phase4-employer@example.com', 'phase4-worker@example.com']) {
    const user = data.users.find((u) => u.email === email);
    if (user) {
      await supabase.from('jobs').delete().eq('employer_id', user.id);
      await supabase.auth.admin.deleteUser(user.id);
      console.log('deleted', email);
    }
  }
}
main();
"
```

- [ ] **Step 5: Report results**

Note clearly which of Step 3's 11 checks passed. If any fail, do not mark Phase 4 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 4 Definition of Done

- [ ] An approved employer can create a job; it's immediately visible on `/jobs` with `status = 'open'`.
- [ ] A non-employer visiting `/jobs/new` sees a clear prompt to verify, with a working link, not a blank page or a form they can't use.
- [ ] Any authenticated user can browse `/jobs`, and search by keyword, filter by category, and filter by payment range — each independently and in combination.
- [ ] Distance-based sorting/filtering works from a live browser geolocation read, without ever persisting that location anywhere.
- [ ] The job detail page shows correct data and a working link to view the location on Google Maps (no embedded map in this phase).
- [ ] An employer can edit their own job while it's `open`; editing is blocked (with a clear result — 404 on the edit page) once the job is not `open`, and blocked for anyone who isn't that job's employer.
- [ ] `getJobDetail` never reveals a draft/cancelled/non-visible job to an unauthorized caller, and never distinguishes "doesn't exist" from "not visible" in its response.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
