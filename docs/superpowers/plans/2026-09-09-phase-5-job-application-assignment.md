# Phase 5 — Job Application & Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any authenticated worker apply to an open job (and cancel a pending application), let the job's employer view applicants and either reject one directly or select a worker (which atomically assigns the job, accepts that application, and rejects every other pending one), and let a worker see their own application history.

**Architecture:** `job_applications` and `job_assignments` already exist (Phase 1 migration) with SELECT-only RLS and no write policy — matching `jobs`, all writes go through a service-role DAL (`lib/services/applications.ts`). Apply/cancel/reject are simple single-row writes with an invariant already enforced by an existing partial unique index. Selecting a worker touches four things atomically (insert assignment, accept one application, reject the rest, flip job status), so it's a single `SECURITY DEFINER` Postgres function (`select_job_worker`) — the same "atomic review function" pattern Phase 3 established for `review_employer_verification`.

**Tech Stack:** Next.js 16.3.4 (Server Actions, `useActionState`, native `<form>`), Zod v4, Supabase (service-role client for `job_applications`/`job_assignments` writes; the regular auth-context client only for the `select_job_worker` RPC call — see Global Constraints), Supabase CLI (`npx supabase db push`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-job-application-assignment-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §12-13, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` STEP 5, and Phase 3/4's plans for schema and conventions this phase builds on.

## Global Constraints

- `job_applications`/`job_assignments` have SELECT-only RLS and no write policy — every write goes through `lib/services/applications.ts` using `createServiceClient()`, matching Phase 4's rule for `jobs`.
- **The `select_job_worker` RPC must be called via the regular auth-context client (`createClient()` from `lib/supabase/server.ts`), never `createServiceClient()`.** The function is `SECURITY DEFINER` and internally re-derives `auth.uid()` to enforce that the caller owns the job. Under the service-role client, `auth.uid()` resolves to `NULL` inside the function, and in `plpgsql`, `v_employer_id <> NULL` evaluates to `NULL` (falsy) — silently skipping the `FORBIDDEN` check entirely. Calling this RPC with the service-role client is a security bug, not a style choice.
- Accepting one application (via `select_job_worker`) atomically rejects every other `'pending'` application on the same job and transitions `jobs.status` to `'assigned'` — this must happen inside the RPC's single transaction, never as separate sequential JS calls (a partial failure between them would leave the job in an inconsistent state).
- A worker cannot apply to their own job (`applyToJob` checks `job.employer_id !== user.id` before inserting).
- A worker may have at most one *active* (`'pending'` or `'accepted'`) application per job — already enforced at the DB level by the existing partial unique index `job_applications_one_active_per_worker_job`. Translate its unique-violation (`error.code === '23505'`) into a friendly `CONFLICT`, never a raw `INTERNAL_ERROR`. A worker MAY re-apply after a rejection or cancellation — never add an application-count cap.
- `cancelApplication` only succeeds while the application is `'pending'`, and only for the worker who owns it. `rejectApplication`/`selectWorker` only succeed while the job's `status` is `'open'` and the application is `'pending'` — every one of these is enforced with a write-time filter (`.eq(...)` on the update, checking the affected-row count), not just a pre-read check, matching Phase 4's TOCTOU fix for `updateJob`.
- No notification is sent on any status change in this phase — the `notifications` table stays untouched (deferred per the spec).
- Zod schemas trim before validating (`.trim()` before `.max()`/regex, not after) — consistent with every prior phase.
- Every Server Action re-verifies authentication/authorization inside itself via the service layer — never rely on `proxy.ts`'s redirect alone.
- `app/jobs/[id]/applicants` is visible only to that job's own employer — `notFound()` for anyone else, matching this repo's established "hide, don't 403" convention for owner-only routes.

---

### Task 1: Validation schema (Zod) for the application form

**Files:**
- Create: `lib/validations/application.ts`
- Create: `lib/validations/application.test.ts`

**Interfaces:**
- Produces: `ApplyToJobSchema`, `ApplyToJobInput` (type), `ApplicationFormState` — consumed by Task 3 (service layer) and Task 4 (Server Action + form).

- [ ] **Step 1: Write the failing tests**

Create `lib/validations/application.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApplyToJobSchema } from './application'

describe('ApplyToJobSchema', () => {
  it('accepts an empty input with no message', () => {
    const result = ApplyToJobSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toBeUndefined()
    }
  })

  it('accepts a valid message and trims whitespace', () => {
    const result = ApplyToJobSchema.safeParse({ message: '  Saya berpengalaman.  ' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.message).toBe('Saya berpengalaman.')
    }
  })

  it('accepts a message exactly at the 1000-character limit', () => {
    const result = ApplyToJobSchema.safeParse({ message: 'a'.repeat(1000) })
    expect(result.success).toBe(true)
  })

  it('rejects a message longer than 1000 characters', () => {
    const result = ApplyToJobSchema.safeParse({ message: 'a'.repeat(1001) })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/validations/application.test.ts
```

Expected: FAIL — `Cannot find module './application'`.

- [ ] **Step 3: Implement the schema**

Create `lib/validations/application.ts`:

```ts
import { z } from 'zod'

export const ApplyToJobSchema = z.object({
  message: z
    .string()
    .trim()
    .max(1000, { error: 'Pesan maksimal 1000 karakter.' })
    .optional(),
})

export type ApplyToJobInput = z.infer<typeof ApplyToJobSchema>

export type ApplicationFormState =
  | {
      errors?: {
        message?: string[]
      }
      message?: string
    }
  | undefined
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/application.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validations
git commit -m "feat: add Zod validation schema for job applications"
```

---

### Task 2: Database migration — atomic `select_job_worker` function

**Files:**
- Create: `supabase/migrations/<timestamp>_job_application_selection.sql`

**Interfaces:**
- Produces: Postgres function `public.select_job_worker(p_job_id uuid, p_application_id uuid) returns void` — consumed by Task 3's `selectWorker`.
- Consumes: `public.jobs`, `public.job_applications`, `public.job_assignments` (all Phase 1).

- [ ] **Step 1: Re-establish the Supabase CLI link**

The CLI's link state is git-ignored and does not survive between sessions — `supabase/config.toml` (tracked) already holds the project ref, but the link must be re-established:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

(Get a token from https://supabase.com/dashboard/account/tokens if needed. `link` will prompt for the database password.)

- [ ] **Step 2: Verify the link**

```bash
npx supabase migration list
```

Expected: lists every migration through `20260908090000_avatars_select_policy.sql` as applied on both `Local` and `Remote`. If anything is missing from `Remote`, stop and resolve that discrepancy before continuing.

- [ ] **Step 3: Create the migration file**

```bash
npx supabase migration new job_application_selection
```

Note the generated filename (e.g. `supabase/migrations/20260909091500_job_application_selection.sql`) — edit that exact file in the next step.

- [ ] **Step 4: Write the migration**

Replace the file's contents with:

```sql
-- Atomically select a worker for an open job: creates the active
-- assignment, accepts the chosen application, rejects every other
-- pending application on the same job, and transitions the job to
-- 'assigned' — all in one transaction, so no concurrent caller can
-- observe (or create) a job with two active workers or two accepted
-- applications. SECURITY DEFINER so it can write job_assignments/
-- job_applications despite neither having a write RLS policy; it must
-- therefore re-derive every authorization check itself rather than
-- trust RLS.
create or replace function public.select_job_worker(
  p_job_id uuid,
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_job_status text;
  v_worker_id uuid;
  v_application_status text;
  v_application_job_id uuid;
begin
  select employer_id, status into v_employer_id, v_job_status
  from public.jobs
  where id = p_job_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_employer_id <> (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_job_status <> 'open' then
    raise exception 'CONFLICT: job not open';
  end if;

  select job_id, worker_id, status into v_application_job_id, v_worker_id, v_application_status
  from public.job_applications
  where id = p_application_id
  for update;

  if v_worker_id is null then
    raise exception 'NOT_FOUND: application';
  end if;

  if v_application_job_id <> p_job_id then
    raise exception 'VALIDATION_ERROR: application does not belong to job';
  end if;

  if v_application_status <> 'pending' then
    raise exception 'CONFLICT: application not pending';
  end if;

  insert into public.job_assignments (job_id, worker_id, status)
  values (p_job_id, v_worker_id, 'active');

  update public.job_applications
  set status = 'accepted',
      reviewed_at = now()
  where id = p_application_id;

  update public.job_applications
  set status = 'rejected',
      reviewed_at = now()
  where job_id = p_job_id
    and id <> p_application_id
    and status = 'pending';

  update public.jobs
  set status = 'assigned'
  where id = p_job_id;
end;
$$;

revoke execute on function public.select_job_worker from public, anon;
grant execute on function public.select_job_worker to authenticated;
```

- [ ] **Step 5: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`.

- [ ] **Step 6: Verify**

```bash
npx supabase migration list
```

Expected: the new `job_application_selection` migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 7: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: the file updates — diff should show `select_job_worker` appear under the `public` schema's `Functions` block, alongside the existing `is_admin`/`review_employer_verification` entries. No table columns change.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Task 3).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add select_job_worker atomic assignment function"
```

---

### Task 3: Applications service layer

**Files:**
- Create: `lib/services/applications.ts`

**Interfaces:**
- Produces: `ApplicantSummary`, `MyApplicationSummary` (interfaces); `applyToJob(jobId, input)`, `cancelApplication(applicationId)`, `rejectApplication(applicationId)`, `getApplicationsForJob(jobId)`, `getMyApplications()`, `getMyApplicationForJob(jobId)`, `selectWorker(jobId, applicationId)` — consumed by Task 4 (apply/cancel actions), Task 5 (applicants page + select/reject actions), Task 6 (my-applications page).
- Consumes: `requireRole`, `getCurrentUser` (Phase 1's `lib/auth/get-current-user.ts`), `createServiceClient` (Phase 1's `lib/supabase/service.ts`), `createClient` (Phase 1's `lib/supabase/server.ts`), `appError` (Phase 1's `lib/errors.ts`), `ApplyToJobSchema`, `ApplyToJobInput` (Task 1).

- [ ] **Step 1: Write the service layer**

Create `lib/services/applications.ts`:

```ts
import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import { ApplyToJobSchema, type ApplyToJobInput } from '@/lib/validations/application'

type ServiceClient = ReturnType<typeof createServiceClient>

export async function applyToJob(jobId: string, input: ApplyToJobInput): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }
  const validated = ApplyToJobSchema.parse(input)

  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id, status')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id === user.id) {
    throw appError('FORBIDDEN', 'Anda tidak dapat melamar pekerjaan milik sendiri.')
  }
  if (job.status !== 'open') {
    throw appError('CONFLICT', 'Pekerjaan ini sudah tidak menerima lamaran.')
  }

  const { data, error } = await supabase
    .from('job_applications')
    .insert({
      job_id: jobId,
      worker_id: user.id,
      message: validated.message || null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      throw appError('CONFLICT', 'Anda sudah memiliki lamaran aktif untuk pekerjaan ini.')
    }
    throw appError('INTERNAL_ERROR')
  }

  return { id: data.id }
}

export async function cancelApplication(applicationId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()

  const { data: application, error: fetchError } = await supabase
    .from('job_applications')
    .select('id, worker_id, status')
    .eq('id', applicationId)
    .maybeSingle()

  if (fetchError || !application) {
    throw appError('NOT_FOUND')
  }
  if (application.worker_id !== user.id) {
    throw appError('FORBIDDEN')
  }
  if (application.status !== 'pending') {
    throw appError('CONFLICT', 'Lamaran ini sudah tidak berstatus "pending".')
  }

  const { data: updated, error } = await supabase
    .from('job_applications')
    .update({ status: 'cancelled' })
    .eq('id', applicationId)
    .eq('worker_id', user.id)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
  if (!updated || updated.length === 0) {
    throw appError('CONFLICT', 'Lamaran ini sudah tidak berstatus "pending".')
  }
}

export async function rejectApplication(applicationId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()

  const { data: application, error: fetchError } = await supabase
    .from('job_applications')
    .select('id, job_id, status')
    .eq('id', applicationId)
    .maybeSingle()

  if (fetchError || !application) {
    throw appError('NOT_FOUND')
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id, status')
    .eq('id', application.job_id)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }
  if (job.status !== 'open') {
    throw appError('CONFLICT', 'Pekerjaan ini sudah tidak menerima lamaran.')
  }
  if (application.status !== 'pending') {
    throw appError('CONFLICT', 'Lamaran ini sudah ditinjau sebelumnya.')
  }

  const { data: updated, error } = await supabase
    .from('job_applications')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', applicationId)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
  if (!updated || updated.length === 0) {
    throw appError('CONFLICT', 'Lamaran ini sudah ditinjau sebelumnya.')
  }
}

export interface ApplicantSummary {
  id: string
  workerId: string
  workerName: string
  status: string
  message: string | null
  appliedAt: string
}

async function loadProfileNames(
  supabase: ServiceClient,
  workerIds: string[]
): Promise<Map<string, string>> {
  if (workerIds.length === 0) {
    return new Map()
  }

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', workerIds)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))
}

export async function getApplicationsForJob(jobId: string): Promise<ApplicantSummary[]> {
  const user = await requireRole('employer')
  const supabase = createServiceClient()

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('id, employer_id')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }

  const { data: applications, error } = await supabase
    .from('job_applications')
    .select('id, worker_id, status, message, applied_at')
    .eq('job_id', jobId)
    .order('applied_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = applications ?? []
  const nameById = await loadProfileNames(
    supabase,
    rows.map((row) => row.worker_id)
  )

  return rows.map((row) => ({
    id: row.id,
    workerId: row.worker_id,
    workerName: nameById.get(row.worker_id) ?? 'Tidak diketahui',
    status: row.status,
    message: row.message,
    appliedAt: row.applied_at,
  }))
}

export interface MyApplicationSummary {
  id: string
  jobId: string
  jobTitle: string
  status: string
  appliedAt: string
}

async function loadJobTitles(supabase: ServiceClient, jobIds: string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) {
    return new Map()
  }

  const { data: jobs, error } = await supabase.from('jobs').select('id, title').in('id', jobIds)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return new Map((jobs ?? []).map((job) => [job.id, job.title]))
}

export async function getMyApplications(): Promise<MyApplicationSummary[]> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()
  const { data: applications, error } = await supabase
    .from('job_applications')
    .select('id, job_id, status, applied_at')
    .eq('worker_id', user.id)
    .order('applied_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = applications ?? []
  const titleById = await loadJobTitles(
    supabase,
    rows.map((row) => row.job_id)
  )

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    jobTitle: titleById.get(row.job_id) ?? 'Pekerjaan tidak diketahui',
    status: row.status,
    appliedAt: row.applied_at,
  }))
}

export async function getMyApplicationForJob(jobId: string): Promise<MyApplicationSummary | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const supabase = createServiceClient()
  const { data: application, error } = await supabase
    .from('job_applications')
    .select('id, job_id, status, applied_at')
    .eq('worker_id', user.id)
    .eq('job_id', jobId)
    .order('applied_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !application) {
    return null
  }

  const { data: job } = await supabase.from('jobs').select('title').eq('id', jobId).maybeSingle()

  return {
    id: application.id,
    jobId: application.job_id,
    jobTitle: job?.title ?? 'Pekerjaan tidak diketahui',
    status: application.status,
    appliedAt: application.applied_at,
  }
}

function mapSelectWorkerError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT: job not open')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah tidak berstatus "open".')
  }
  if (message.includes('CONFLICT: application not pending')) {
    return appError('CONFLICT', 'Lamaran ini sudah ditinjau sebelumnya.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function selectWorker(jobId: string, applicationId: string): Promise<void> {
  const user = await requireRole('employer')

  const serviceClient = createServiceClient()
  const { data: job, error: jobError } = await serviceClient
    .from('jobs')
    .select('id, employer_id')
    .eq('id', jobId)
    .maybeSingle()

  if (jobError || !job) {
    throw appError('NOT_FOUND')
  }
  if (job.employer_id !== user.id) {
    throw appError('FORBIDDEN')
  }

  // select_job_worker is SECURITY DEFINER and re-derives auth.uid() itself
  // to enforce ownership — it must be called with the caller's real
  // session, never the service-role client (see Global Constraints).
  const authClient = await createClient()
  const { error } = await authClient.rpc('select_job_worker', {
    p_job_id: jobId,
    p_application_id: applicationId,
  })

  if (error) {
    throw mapSelectWorkerError(error.message)
  }
}
```

Note: `loadProfileNames`/`loadJobTitles` are private (non-exported) helpers shared where a batch id→field lookup is needed — deliberate two-query-plus-`Map` joins instead of PostgREST embedded selects, to avoid depending on ambiguous embed-return shapes (object vs. array) from the generated types.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. If `job.profiles`/embedded-select shapes were used instead of the `Map`-join pattern above, this is exactly the step that would catch a wrong assumption — but this task's code as written avoids that risk entirely.

- [ ] **Step 3: Commit**

```bash
git add lib/services/applications.ts
git commit -m "feat(applications): add applications service layer"
```

---

### Task 4: Worker-facing apply and cancel

**Files:**
- Create: `app/applications/actions.ts`
- Create: `app/applications/apply-form.tsx`
- Modify: `app/jobs/[id]/page.tsx` (full current content shown below — this task's version)

**Interfaces:**
- Consumes: `applyToJob`, `cancelApplication`, `getMyApplicationForJob` (Task 3); `ApplyToJobSchema`, `ApplicationFormState` (Task 1); `toSafeErrorMessage` (Phase 1's `lib/errors.ts`); `getCurrentUser` (Phase 1); `getJobDetail` (Phase 4's `lib/services/jobs.ts`).
- Produces: `applyToJobAction(jobId, prevState, formData)`, `cancelApplicationAction(applicationId, jobId)` — the former is called via `.bind(null, jobId)` before being passed to `useActionState`, the latter via `.bind(null, applicationId, jobId)` as a plain form action. `ApplyForm` (client component) — used by this task's modified job detail page.

- [ ] **Step 1: Create the Server Actions**

Create `app/applications/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { applyToJob, cancelApplication } from '@/lib/services/applications'
import { ApplyToJobSchema, type ApplicationFormState } from '@/lib/validations/application'
import { toSafeErrorMessage } from '@/lib/errors'

export async function applyToJobAction(
  jobId: string,
  _prevState: ApplicationFormState,
  formData: FormData
): Promise<ApplicationFormState> {
  const validatedFields = ApplyToJobSchema.safeParse({
    message: formData.get('message'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await applyToJob(jobId, validatedFields.data)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/applications/mine')
  return undefined
}

export async function cancelApplicationAction(applicationId: string, jobId: string): Promise<void> {
  try {
    await cancelApplication(applicationId)
  } catch {
    // Swallow: a race (e.g. the employer reviewed it moments earlier) is
    // resolved by the revalidation below showing the application's actual
    // current status — there's no separate error UI for this simple
    // fire-and-forget cancel button.
  }
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/applications/mine')
}
```

- [ ] **Step 2: Create the apply form (client component)**

Create `app/applications/apply-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { applyToJobAction } from './actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

export function ApplyForm({ jobId }: { jobId: string }) {
  const boundAction = applyToJobAction.bind(null, jobId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="message">Pesan (opsional)</Label>
      <Textarea
        id="message"
        name="message"
        placeholder="Ceritakan mengapa Anda cocok untuk pekerjaan ini..."
        rows={3}
      />
      {state?.errors?.message && <p className="text-sm text-destructive">{state.errors.message[0]}</p>}
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengirim...' : 'Lamar Pekerjaan'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Modify the job detail page**

Replace `app/jobs/[id]/page.tsx` in full with:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getJobDetail } from '@/lib/services/jobs'
import { getMyApplicationForJob } from '@/lib/services/applications'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { ApplyForm } from '@/app/applications/apply-form'
import { cancelApplicationAction } from '@/app/applications/actions'
import { Button } from '@/components/ui/button'

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

  const myApplication = !isOwner ? await getMyApplicationForJob(job.id) : null
  const canApply =
    !isOwner &&
    job.status === 'open' &&
    (!myApplication || ['rejected', 'cancelled'].includes(myApplication.status))

  const boundCancelAction = myApplication
    ? cancelApplicationAction.bind(null, myApplication.id, job.id)
    : null

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
      {!isOwner && myApplication && !canApply && (
        <div className="flex flex-col gap-2 rounded border p-3 text-sm">
          <span className="text-muted-foreground">Status Lamaran Anda</span>
          <span className="font-medium">{myApplication.status}</span>
          {myApplication.status === 'pending' && boundCancelAction && (
            <form action={boundCancelAction}>
              <Button type="submit" variant="outline" size="sm">
                Batalkan Lamaran
              </Button>
            </form>
          )}
        </div>
      )}
      {canApply && <ApplyForm jobId={job.id} />}
    </div>
  )
}
```

Note: `canApply` is false whenever `isOwner` is true, so the owner never sees the apply form — this is the self-application block from a UI perspective; `applyToJob`'s own `job.employer_id === user.id` check in Task 3 is the actual enforcement.

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/applications "app/jobs/[id]/page.tsx"
git commit -m "feat(applications): add worker apply and cancel actions"
```

---

### Task 5: Employer-facing applicants page

**Files:**
- Create: `app/jobs/[id]/applicants/actions.ts`
- Create: `app/jobs/[id]/applicants/applicant-row.tsx`
- Create: `app/jobs/[id]/applicants/page.tsx`
- Modify: `app/jobs/[id]/page.tsx` (add one link — see Step 4)
- Modify: `app/jobs/mine/page.tsx` (add one link per job row — see Step 5)

**Interfaces:**
- Consumes: `getApplicationsForJob`, `selectWorker`, `rejectApplication` (Task 3); `getJobDetail` (Phase 4); `toSafeErrorMessage` (Phase 1); `getCurrentUser` (Phase 1).
- Produces: `selectWorkerAction(jobId, applicationId, prevState, formData)`, `rejectApplicationAction(jobId, applicationId, prevState, formData)` — each bound via `.bind(null, jobId, applicationId)` before being passed to `useActionState`.

- [ ] **Step 1: Create the Server Actions**

Create `app/jobs/[id]/applicants/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { rejectApplication, selectWorker } from '@/lib/services/applications'
import { toSafeErrorMessage } from '@/lib/errors'

export type ApplicantActionState = { success: true } | { success: false; message: string } | undefined

export async function selectWorkerAction(
  jobId: string,
  applicationId: string,
  _prevState: ApplicantActionState,
  _formData: FormData
): Promise<ApplicantActionState> {
  try {
    await selectWorker(jobId, applicationId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/applicants`)
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/jobs')
  revalidatePath('/jobs/mine')
  return { success: true }
}

export async function rejectApplicationAction(
  jobId: string,
  applicationId: string,
  _prevState: ApplicantActionState,
  _formData: FormData
): Promise<ApplicantActionState> {
  try {
    await rejectApplication(applicationId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/applicants`)
  return { success: true }
}
```

- [ ] **Step 2: Create the applicant row (client component)**

Create `app/jobs/[id]/applicants/applicant-row.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { rejectApplicationAction, selectWorkerAction } from './actions'
import { Button } from '@/components/ui/button'

interface ApplicantRowProps {
  jobId: string
  applicationId: string
  workerName: string
  message: string | null
  status: string
  appliedAt: string
  canManage: boolean
}

export function ApplicantRow({
  jobId,
  applicationId,
  workerName,
  message,
  status,
  appliedAt,
  canManage,
}: ApplicantRowProps) {
  const boundSelect = selectWorkerAction.bind(null, jobId, applicationId)
  const boundReject = rejectApplicationAction.bind(null, jobId, applicationId)
  const [selectState, selectFormAction, selectPending] = useActionState(boundSelect, undefined)
  const [rejectState, rejectFormAction, rejectPending] = useActionState(boundReject, undefined)

  return (
    <li className="flex flex-col gap-2 rounded border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{workerName}</span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      {message && <p className="text-muted-foreground">{message}</p>}
      <span className="text-xs text-muted-foreground">
        Melamar pada {new Date(appliedAt).toLocaleString('id-ID')}
      </span>
      {canManage && status === 'pending' && (
        <div className="flex gap-2">
          <form action={selectFormAction}>
            <Button type="submit" size="sm" disabled={selectPending || rejectPending}>
              {selectPending ? 'Memilih...' : 'Pilih Pekerja Ini'}
            </Button>
          </form>
          <form action={rejectFormAction}>
            <Button type="submit" variant="outline" size="sm" disabled={selectPending || rejectPending}>
              {rejectPending ? 'Menolak...' : 'Tolak'}
            </Button>
          </form>
        </div>
      )}
      {selectState && !selectState.success && (
        <p className="text-sm text-destructive">{selectState.message}</p>
      )}
      {rejectState && !rejectState.success && (
        <p className="text-sm text-destructive">{rejectState.message}</p>
      )}
    </li>
  )
}
```

- [ ] **Step 3: Create the applicants page**

Create `app/jobs/[id]/applicants/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getJobDetail } from '@/lib/services/jobs'
import { getApplicationsForJob } from '@/lib/services/applications'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { ApplicantRow } from './applicant-row'

export default async function JobApplicantsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const job = await getJobDetail(id)
  if (!job || job.employerId !== user.id) {
    notFound()
  }

  const applicants = await getApplicationsForJob(id)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pelamar: {job.title}</h1>
      {applicants.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada yang melamar pekerjaan ini.</p>
      )}
      <ul className="flex flex-col gap-2">
        {applicants.map((applicant) => (
          <ApplicantRow
            key={applicant.id}
            jobId={id}
            applicationId={applicant.id}
            workerName={applicant.workerName}
            message={applicant.message}
            status={applicant.status}
            appliedAt={applicant.appliedAt}
            canManage={job.status === 'open'}
          />
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Link to the applicants page from the job detail page**

`app/jobs/[id]/page.tsx` currently has this block (added by Task 4):

```tsx
{isOwner && job.status === 'open' && (
  <Link
    href={`/jobs/${job.id}/edit`}
    className="text-sm text-primary underline-offset-4 hover:underline"
  >
    Edit Pekerjaan
  </Link>
)}
```

Add this immediately after it (note this new link is NOT gated on `status === 'open'` — an employer should still be able to review who applied after the job is assigned):

```tsx
{isOwner && (
  <Link
    href={`/jobs/${job.id}/applicants`}
    className="text-sm text-primary underline-offset-4 hover:underline"
  >
    Lihat Pelamar
  </Link>
)}
```

- [ ] **Step 5: Link to the applicants page from "My Jobs"**

Read `app/jobs/mine/page.tsx` first to confirm its current exact content (Phase 4 created it; Task 4 of this plan did not touch it) before editing. Replace the `<ul>` block with:

```tsx
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center justify-between rounded border p-3 text-sm">
            <Link
              href={job.status === 'open' ? `/jobs/${job.id}/edit` : `/jobs/${job.id}`}
              className="flex flex-col gap-1 hover:underline"
            >
              <span className="font-medium">{job.title}</span>
              <span className="text-muted-foreground">{job.status}</span>
            </Link>
            <Link
              href={`/jobs/${job.id}/applicants`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Pelamar
            </Link>
          </li>
        ))}
      </ul>
```

(This replaces the previous single-link `<li>` — each job row now has two separate links instead of the whole row being one clickable link, since there are now two distinct destinations.)

- [ ] **Step 6: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add app/jobs
git commit -m "feat(applications): add employer applicants page with select/reject actions"
```

---

### Task 6: Worker's "My Applications" page and profile link

**Files:**
- Create: `app/applications/mine/page.tsx`
- Modify: `app/profile/page.tsx` (add one link)

**Interfaces:**
- Consumes: `getMyApplications`, `MyApplicationSummary` (Task 3).

- [ ] **Step 1: Create the "My Applications" page**

Create `app/applications/mine/page.tsx`:

```tsx
import Link from 'next/link'
import { getMyApplications } from '@/lib/services/applications'

export default async function MyApplicationsPage() {
  const applications = await getMyApplications()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Lamaran Saya</h1>
      {applications.length === 0 && (
        <p className="text-sm text-muted-foreground">Anda belum melamar pekerjaan apa pun.</p>
      )}
      <ul className="flex flex-col gap-2">
        {applications.map((application) => (
          <li key={application.id}>
            <Link
              href={`/jobs/${application.jobId}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span>{application.jobTitle}</span>
              <span className="text-muted-foreground">{application.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Link from the profile page**

`app/profile/page.tsx` currently has this block (from Phase 4):

```tsx
      <Link href="/jobs" className="text-sm text-primary underline-offset-4 hover:underline">
        Cari Pekerjaan
      </Link>
      {isEmployer && (
```

Insert a new link between them, so any authenticated user (not just employers) sees it:

```tsx
      <Link href="/jobs" className="text-sm text-primary underline-offset-4 hover:underline">
        Cari Pekerjaan
      </Link>
      <Link href="/applications/mine" className="text-sm text-primary underline-offset-4 hover:underline">
        Lamaran Saya
      </Link>
      {isEmployer && (
```

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add app/applications app/profile
git commit -m "feat(applications): add my-applications page and profile link"
```

---

### Task 7: Phase 5 Definition-of-Done verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be the current total (51 as of Phase 4's merge) + Task 1's 4 = 55.

- [ ] **Step 2: Create four throwaway test accounts**

Run as a one-off Node script from the repo root (do not commit it) — one approved-employer account and three plain workers:

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
    email: 'phase5-employer@example.com',
    password: 'password1',
    email_confirm: true,
    user_metadata: { full_name: 'Phase 5 Employer', phone: '081200000006' },
  });
  await supabase.from('user_roles').upsert(
    { user_id: employer.user.id, role: 'employer' },
    { onConflict: 'user_id,role', ignoreDuplicates: true }
  );
  for (const [email, name, phone] of [
    ['phase5-worker-a@example.com', 'Phase 5 Worker A', '081200000007'],
    ['phase5-worker-b@example.com', 'Phase 5 Worker B', '081200000008'],
    ['phase5-worker-c@example.com', 'Phase 5 Worker C', '081200000009'],
  ]) {
    const { data: worker } = await supabase.auth.admin.createUser({
      email,
      password: 'password1',
      email_confirm: true,
      user_metadata: { full_name: name, phone },
    });
    console.log(email, ':', worker.user.id);
  }
  console.log('employer:', employer.user.id);
}
main();
"
```

- [ ] **Step 3: Verify the full flow in a real browser**

```bash
npm run dev
```

Using a real browser (a private/incognito window per account, or logging out/in between):

1. Log in as `phase5-employer@example.com`, create a job (via `/jobs/new`) — note its URL/id.
2. Log in as `phase5-worker-a@example.com`, visit the job's detail page, submit the apply form with a message — confirm the page now shows "Status Lamaran Anda: pending" with a "Batalkan Lamaran" button.
3. Log in as `phase5-worker-b@example.com`, apply to the same job with no message — confirm success.
4. Log in as `phase5-worker-c@example.com`, apply to the same job — confirm success.
5. Log in as the employer, visit `/jobs/[id]/applicants` (via the job detail page's "Lihat Pelamar" link, or `/jobs/mine`'s "Pelamar" link) — confirm all 3 applicants appear with correct names and Worker A's message.
6. As the employer, click "Tolak" on Worker C's row — confirm it disappears from being manageable (status becomes `rejected`, no more buttons on that row) and the job is still `open`.
7. Log in as `phase5-worker-c@example.com` — confirm the job detail page now shows "Status Lamaran Anda: rejected" with no cancel button, and the apply form reappears (re-apply allowed) — submit a second application.
8. Log in as the employer, refresh `/jobs/[id]/applicants` — confirm Worker C's new application appears as `pending` alongside Worker A's and Worker B's.
9. As the employer, click "Pilih Pekerja Ini" on Worker A's row — confirm success, then reload the page: Worker A's row shows `accepted`, Worker B's and Worker C's rows both show `rejected` with no buttons on any row.
10. Log in as `phase5-worker-a@example.com` — confirm the job detail page shows "Status Lamaran Anda: accepted".
11. Log in as `phase5-worker-b@example.com` — confirm the job detail page shows "Status Lamaran Anda: rejected".
12. Visit `/jobs` as any worker — confirm the job no longer appears in the open listing (status is now `assigned`).
13. Log in as the employer, visit `/jobs/mine` — confirm the job shows status `assigned`, and its "Edit Pekerjaan" link is gone from the job detail page (status is no longer `open`).
14. Log in as the employer account (which also holds the `worker` role from registration, per PRD default), visit their OWN job's detail page — confirm no apply form appears and no "Status Lamaran Anda" section appears either (the page's `canApply`/`myApplication` logic is gated on `!isOwner`, so an owner never sees worker-facing UI on their own job, regardless of also holding the worker role). This exercises the UI-level guard; `applyToJob`'s own `job.employer_id === user.id` check (Task 3) is the actual enforcement and has no UI path to trigger directly — confirm by code review that the check is present and precedes the insert.
15. As `phase5-worker-b@example.com`, confirm there is no UI control anywhere that references another worker's application id (the job detail page only ever binds `cancelApplicationAction` to `myApplication.id`, which is always the viewer's own application per `getMyApplicationForJob`'s `.eq('worker_id', user.id)` filter). Confirm by code review of Task 3's `cancelApplication` that the `application.worker_id !== user.id` check exists and precedes the update, as the actual enforcement for this case.

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
  const emails = [
    'phase5-employer@example.com',
    'phase5-worker-a@example.com',
    'phase5-worker-b@example.com',
    'phase5-worker-c@example.com',
  ];
  for (const email of emails) {
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

Note clearly which of Step 3's 15 checks passed. If any fail, do not mark Phase 5 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 5 Definition of Done

- [ ] A worker can apply to an open job (with an optional message) and cannot apply to their own job.
- [ ] A worker cannot submit a second active application to the same job while one is pending/accepted, but can re-apply after a rejection or cancellation.
- [ ] A worker can cancel their own pending application; cancelling anyone else's is rejected.
- [ ] An employer can view all applicants for their own job (and only their own job — `notFound()` otherwise), see each applicant's name, message, and status.
- [ ] An employer can reject a specific pending applicant directly, without selecting anyone.
- [ ] An employer can select a worker: the job atomically becomes `assigned`, that application becomes `accepted`, every other pending application on the job becomes `rejected`, and a `job_assignments` row is created — all in one transaction (the `select_job_worker` RPC).
- [ ] Once a job is `assigned`, it disappears from the open `/jobs` listing but still appears (with its current status) on `/jobs/mine`, and its "Edit Pekerjaan" link no longer appears.
- [ ] A worker can see all of their own applications (with job title and status) on `/applications/mine`.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
