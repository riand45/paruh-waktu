# Phase 11 (Admin Job/Category Management, Settings, Audit Log) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin browse/search/cancel any job, create/edit/activate/deactivate job categories, configure platform settings (including, for the first time, the admin bank account), and view the audit log.

**Architecture:** One new migration adds a `cancel_job` RPC (for jobs with no verified payment yet), widens Phase 10's `cancel_job_and_refund` to also reject an already-`cancelled` job, and adds three category RPCs plus one generic `update_platform_setting` RPC — every new RPC follows the same `is_admin()` + row-lock + `audit_logs` + revoke/grant shape already established. The Job Management detail page picks whichever cancellation RPC fits a job's current state; Category Management and Settings each get a small service file plus a page; Audit Log is a single read-only list.

**Tech Stack:** Next.js (Server Components + Server Actions), Supabase (Postgres, RLS, `SECURITY DEFINER` RPCs), Zod (new: platform settings), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-admin-job-category-settings-audit-design.md`

## Global Constraints

- Every new RPC: `language plpgsql`, `security definer`, `set search_path = ''`, an `is_admin()` check as its first line, row locking via `for update` before reading a status the RPC branches on, an `audit_logs` insert, and `revoke execute on function ... from public, anon, service_role; grant execute on function ... to authenticated;` — copy this shape from `supabase/migrations/20260911042422_refund_and_admin_management.sql`'s existing functions.
- `cancel_job` is reachable only when `jobs.status not in ('cancelled', 'completed')` AND no `payments` row for that job has `status = 'verified'` (that case must use `cancel_job_and_refund` instead — the RPC itself rejects it, not just the UI).
- The one shared audit action `'JOB_CANCELLED'` is used by both `cancel_job` and `cancel_job_and_refund` — they cancel the same entity type for the same reason; no new action name needed for the plain-cancel path.
- `getActiveJobCategories()` (`lib/services/job-categories.ts`) keeps its exact existing signature and `{id, name}[]` shape — `app/jobs/page.tsx` and `lib/services/jobs.ts`'s `assertActiveCategory` both depend on it verbatim. All new category functions are additions to this file, never a replacement of the existing one.
- Admin Settings writes go through one generic `update_platform_setting(p_key, p_value)` RPC, called once per field from the Server Action — never a bespoke RPC per setting.
- No new pagination anywhere (matches every existing list page). No filtering on the Audit Log page (plain list, per the approved design).
- No new Zod schema for category names or cancellation reasons — both use the same plain-required-string client-side check already established by `ProcessRejectForm`/`CancelRefundForm`. Only Admin Settings gets a new Zod schema (its fields have real per-field validation rules).

---

### Task 1: Database migration — `cancel_job`, `cancel_job_and_refund` hardening, category RPCs, settings RPC

**Files:**
- Create: `supabase/migrations/<timestamp>_admin_job_category_settings_audit.sql`
- Modify: `lib/supabase/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `public.cancel_job(p_job_id uuid, p_reason text) returns void`, `public.create_job_category(p_name text) returns uuid`, `public.update_job_category(p_id uuid, p_name text) returns void`, `public.set_job_category_active(p_id uuid, p_is_active boolean) returns void`, `public.update_platform_setting(p_key text, p_value jsonb) returns void` — consumed by Task 2 (`cancel_job`), Task 4 (category RPCs), Task 6 (settings RPC).
- Produces: `public.cancel_job_and_refund`'s exception message for an already-terminal job widens from `'CONFLICT: job already completed'` to `'CONFLICT: job already cancelled or completed'` — Task 2 must update `lib/services/refunds.ts`'s existing error mapper for this in the same task, or the existing already-`completed` case regresses to `INTERNAL_ERROR`.
- Consumes: `public.is_admin()`, `public.audit_logs`, `public.job_categories` (Phase 1), `public.platform_settings` (Phase 1).

- [ ] **Step 1: Re-link and verify the Supabase CLI**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
npx supabase migration list
```

Expected: every migration through `20260911070450_fix_is_admin_respects_suspension.sql` shows applied on both `Local` and `Remote`. If anything is missing from Remote, stop and investigate before continuing.

- [ ] **Step 2: Create the migration file**

```bash
npx supabase migration new admin_job_category_settings_audit
```

- [ ] **Step 3: Write the migration**

Replace the file's contents with:

```sql
-- Admin Job Management (PRD §35): a second cancellation path for jobs
-- that never reached a verified payment. cancel_job_and_refund (Phase 10)
-- stays the only path once a payment is verified -- this RPC explicitly
-- rejects that case so a direct API call can't bypass the refund
-- requirement, mirroring this codebase's established defense-in-depth
-- pattern of re-checking state server-side rather than trusting the UI.
create or replace function public.cancel_job(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_status text;
  v_has_verified_payment boolean;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_job_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_job_status in ('cancelled', 'completed') then
    raise exception 'CONFLICT: job already cancelled or completed';
  end if;

  select exists (
    select 1 from public.payments where job_id = p_job_id and status = 'verified'
  ) into v_has_verified_payment;

  if v_has_verified_payment then
    raise exception 'CONFLICT: use cancel_job_and_refund';
  end if;

  update public.jobs
  set status = 'cancelled', cancelled_reason = p_reason
  where id = p_job_id;

  update public.job_assignments
  set status = 'cancelled'
  where job_id = p_job_id and status = 'active';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'JOB_CANCELLED', 'job', p_job_id, p_reason);
end;
$$;

revoke execute on function public.cancel_job from public, anon, service_role;
grant execute on function public.cancel_job to authenticated;

-- Hardening fix (flagged by Phase 10's final review as a deferred Minor):
-- cancel_job_and_refund had no guard against being called again on an
-- already-cancelled job (only 'completed' was checked). Widen it to match
-- cancel_job's own check, so both RPCs raise the identical message for
-- "nothing left to cancel". create or replace preserves the existing
-- revoke/grant -- no need to restate them.
create or replace function public.cancel_job_and_refund(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_payment_status text;
  v_job_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select id, status into v_payment_id, v_payment_status
  from public.payments
  where job_id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: payment';
  end if;

  if v_payment_status <> 'verified' then
    raise exception 'CONFLICT: payment not verified';
  end if;

  select status into v_job_status
  from public.jobs
  where id = p_job_id
  for update;

  if v_job_status in ('cancelled', 'completed') then
    raise exception 'CONFLICT: job already cancelled or completed';
  end if;

  update public.jobs
  set status = 'cancelled', cancelled_reason = p_reason
  where id = p_job_id;

  update public.job_assignments
  set status = 'cancelled'
  where job_id = p_job_id and status = 'active';

  update public.payments
  set status = 'refund_pending'
  where id = v_payment_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'JOB_CANCELLED', 'job', p_job_id, p_reason);
end;
$$;

-- Admin Category Management (PRD §38). job_categories has no INSERT/UPDATE
-- policy at all today -- these RPCs are the only way to write to it.
create or replace function public.create_job_category(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  begin
    insert into public.job_categories (name) values (p_name) returning id into v_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: category name already exists';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'CATEGORY_CREATED', 'job_category', v_id, p_name);

  return v_id;
end;
$$;

revoke execute on function public.create_job_category from public, anon, service_role;
grant execute on function public.create_job_category to authenticated;

create or replace function public.update_job_category(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  begin
    update public.job_categories set name = p_name, updated_at = now() where id = p_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: category name already exists';
  end;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'CATEGORY_UPDATED', 'job_category', p_id, p_name);
end;
$$;

revoke execute on function public.update_job_category from public, anon, service_role;
grant execute on function public.update_job_category to authenticated;

create or replace function public.set_job_category_active(p_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.job_categories set is_active = p_is_active, updated_at = now() where id = p_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values (
    (select auth.uid()),
    case when p_is_active then 'CATEGORY_ACTIVATED' else 'CATEGORY_DEACTIVATED' end,
    'job_category',
    p_id,
    null
  );
end;
$$;

revoke execute on function public.set_job_category_active from public, anon, service_role;
grant execute on function public.set_job_category_active to authenticated;

-- Admin Settings (PRD §39). platform_settings has no UPDATE policy at all
-- today -- this is the only way to write to it. entity_id is left null
-- since platform_settings.key is text, not the uuid audit_logs.entity_id
-- expects; p_key in the description names which setting changed.
create or replace function public.update_platform_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.platform_settings
  set value = p_value, updated_at = now(), updated_by = (select auth.uid())
  where key = p_key;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'PLATFORM_SETTING_UPDATED', 'platform_setting', null, p_key);
end;
$$;

revoke execute on function public.update_platform_setting from public, anon, service_role;
grant execute on function public.update_platform_setting to authenticated;
```

- [ ] **Step 4: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`.

- [ ] **Step 5: Verify**

```bash
npx supabase migration list
```

Expected: the new migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 6: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: diff shows the five new functions under `public.Functions` (`cancel_job`, `create_job_category`, `update_job_category`, `set_job_category_active`, `update_platform_setting`). No table columns change.

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add cancel_job, category management, and platform settings RPCs"
```

---

### Task 2: Admin Job Management service layer

**Files:**
- Create: `lib/services/admin-jobs.ts`
- Modify: `lib/services/jobs.ts:234-249` (`JobDetail` — add `createdAt`), `lib/services/jobs.ts:251-308` (`getJobDetail` — select/return `created_at`)
- Modify: `lib/services/refunds.ts:16` (widen the error-message check for the migration's widened exception text)

**Interfaces:**
- Produces: `AdminJobSummary`, `AdminJobFilters`, `getJobsForAdmin(filters?): Promise<AdminJobSummary[]>`, `AdminJobDetail`, `getJobDetailForAdmin(jobId): Promise<AdminJobDetail | null>`, `cancelJob(jobId, reason): Promise<void>` — consumed by Task 3's pages/actions.
- Consumes: `cancel_job` RPC (Task 1), `getJobDetail` (extended, this task), `cancelJobAndRefund` (Phase 10, `lib/services/refunds.ts`, untouched signature — Task 3 imports it directly).

- [ ] **Step 1: Add `createdAt` to `JobDetail` and `getJobDetail`**

In `lib/services/jobs.ts`, modify the `JobDetail` interface (lines 234-249) to add one field:

```ts
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
  assignedWorkerId: string | null
  cancelledReason: string | null
  createdAt: string
}
```

In `getJobDetail` (lines 251-308), add `created_at` to the `.select(...)` column list:

```ts
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      'id, title, description, address, latitude, longitude, category_id, payment_amount, duration_minutes, deadline, status, employer_id, assigned_worker_id, cancelled_reason, created_at'
    )
    .eq('id', jobId)
    .maybeSingle()
```

and add `createdAt: job.created_at` to the returned object at the end of the function.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Widen `refunds.ts`'s error mapper for the migration's widened exception text**

In `lib/services/refunds.ts`, `mapCancelJobAndRefundError` (around line 16) currently checks `message.includes('job already completed')`. Task 1's migration widens the RPC's exception to `'CONFLICT: job already cancelled or completed'`, which no longer contains that exact substring — without this fix, that case would silently regress to a generic `INTERNAL_ERROR`. Change the check to:

```ts
  if (message.includes('already cancelled or completed')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah dibatalkan atau selesai.')
  }
```

- [ ] **Step 4: Create `lib/services/admin-jobs.ts`**

```ts
import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { getJobDetail } from '@/lib/services/jobs'

export interface AdminJobSummary {
  id: string
  title: string
  status: string
  categoryId: string
  categoryName: string
  employerId: string
  employerName: string
  assignedWorkerId: string | null
  assignedWorkerName: string | null
  createdAt: string
}

export interface AdminJobFilters {
  search?: string
  status?: string
  categoryId?: string
}

export async function getJobsForAdmin(filters: AdminJobFilters = {}): Promise<AdminJobSummary[]> {
  await requireRole('admin')
  const supabase = createServiceClient()

  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('id, title, status, category_id, employer_id, assigned_worker_id, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = jobs ?? []
  if (rows.length === 0) {
    return []
  }

  const categoryIds = [...new Set(rows.map((row) => row.category_id))]
  const { data: categories, error: categoriesError } = await supabase
    .from('job_categories')
    .select('id, name')
    .in('id', categoryIds)
  if (categoriesError) {
    throw appError('INTERNAL_ERROR')
  }
  const categoryNameById = new Map((categories ?? []).map((category) => [category.id, category.name]))

  const profileIds = [
    ...new Set([
      ...rows.map((row) => row.employer_id),
      ...rows.filter((row) => row.assigned_worker_id).map((row) => row.assigned_worker_id as string),
    ]),
  ]
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', profileIds)
  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  let result: AdminJobSummary[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    categoryId: row.category_id,
    categoryName: categoryNameById.get(row.category_id) ?? 'Tidak diketahui',
    employerId: row.employer_id,
    employerName: nameById.get(row.employer_id) ?? 'Tidak diketahui',
    assignedWorkerId: row.assigned_worker_id,
    assignedWorkerName: row.assigned_worker_id ? (nameById.get(row.assigned_worker_id) ?? 'Tidak diketahui') : null,
    createdAt: row.created_at,
  }))

  if (filters.search) {
    const term = filters.search.toLowerCase()
    result = result.filter((row) => row.title.toLowerCase().includes(term))
  }
  if (filters.status) {
    result = result.filter((row) => row.status === filters.status)
  }
  if (filters.categoryId) {
    result = result.filter((row) => row.categoryId === filters.categoryId)
  }

  return result
}

export interface AdminJobDetail {
  id: string
  title: string
  description: string
  address: string
  status: string
  categoryId: string
  categoryName: string
  employerId: string
  employerName: string
  assignedWorkerId: string | null
  assignedWorkerName: string | null
  paymentAmount: number
  durationMinutes: number
  deadline: string
  cancelledReason: string | null
  paymentStatus: string | null
  createdAt: string
}

export async function getJobDetailForAdmin(jobId: string): Promise<AdminJobDetail | null> {
  await requireRole('admin')
  const job = await getJobDetail(jobId)
  if (!job) {
    return null
  }

  const supabase = createServiceClient()

  const { data: category } = await supabase
    .from('job_categories')
    .select('name')
    .eq('id', job.categoryId)
    .maybeSingle()

  const { data: employerProfile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', job.employerId)
    .maybeSingle()

  let assignedWorkerName: string | null = null
  if (job.assignedWorkerId) {
    const { data: workerProfile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', job.assignedWorkerId)
      .maybeSingle()
    assignedWorkerName = workerProfile?.full_name ?? 'Tidak diketahui'
  }

  const { data: payment } = await supabase.from('payments').select('status').eq('job_id', jobId).maybeSingle()

  return {
    id: job.id,
    title: job.title,
    description: job.description,
    address: job.address,
    status: job.status,
    categoryId: job.categoryId,
    categoryName: category?.name ?? 'Tidak diketahui',
    employerId: job.employerId,
    employerName: employerProfile?.full_name ?? 'Tidak diketahui',
    assignedWorkerId: job.assignedWorkerId,
    assignedWorkerName,
    paymentAmount: job.paymentAmount,
    durationMinutes: job.durationMinutes,
    deadline: job.deadline,
    cancelledReason: job.cancelledReason,
    paymentStatus: payment?.status ?? null,
    createdAt: job.createdAt,
  }
}

function mapCancelJobError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('use cancel_job_and_refund')) {
    return appError('CONFLICT', 'Pekerjaan ini memiliki pembayaran terverifikasi — gunakan alur refund.')
  }
  if (message.includes('already cancelled or completed')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah dibatalkan atau selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function cancelJob(jobId: string, reason: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('cancel_job', {
    p_job_id: jobId,
    p_reason: reason,
  })

  if (error) {
    throw mapCancelJobError(error.message)
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/services/admin-jobs.ts lib/services/jobs.ts lib/services/refunds.ts
git commit -m "feat(admin): add job management service layer and cancel_job wiring"
```

---

### Task 3: Admin Job Management UI

**Files:**
- Create: `app/admin/jobs/page.tsx`, `app/admin/jobs/job-filters.tsx`, `app/admin/jobs/actions.ts`, `app/admin/jobs/[id]/page.tsx`, `app/admin/jobs/[id]/cancel-job-form.tsx`

**Interfaces:**
- Consumes: `getJobsForAdmin`, `getJobDetailForAdmin`, `cancelJob` (Task 2); `cancelJobAndRefund` (Phase 10, `lib/services/refunds.ts`); `getActiveJobCategories` (existing, `lib/services/job-categories.ts`).

- [ ] **Step 1: Create the client-side filter component**

```tsx
'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const STATUSES = [
  'draft',
  'open',
  'assigned',
  'waiting_payment',
  'payment_review',
  'payment_verified',
  'in_progress',
  'waiting_confirmation',
  'completed',
  'cancelled',
  'payment_rejected',
]

export function JobFilters({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') ?? '')

  function applyFilters() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (categoryId) params.set('categoryId', categoryId)
    router.push(`/admin/jobs?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Cari judul pekerjaan..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Kategori</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="button" onClick={applyFilters}>
        Terapkan Filter
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Create the list page**

```tsx
import { Suspense } from 'react'
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getJobsForAdmin } from '@/lib/services/admin-jobs'
import { getActiveJobCategories } from '@/lib/services/job-categories'
import { JobFilters } from './job-filters'

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; categoryId?: string }>
}) {
  await requireAdminOr404()
  const { search, status, categoryId } = await searchParams

  const [jobs, { categories }] = await Promise.all([
    getJobsForAdmin({ search, status, categoryId }),
    getActiveJobCategories(),
  ])

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pekerjaan</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <JobFilters categories={categories} />
      </Suspense>
      {jobs.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada pekerjaan ditemukan.</p>}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={`/admin/jobs/${job.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col">
                <span className="font-medium">{job.title}</span>
                <span className="text-muted-foreground">{job.employerName}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span>{job.assignedWorkerName ?? '-'}</span>
                <span className="text-muted-foreground">{job.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Note: the category filter draws from `getActiveJobCategories()` (active categories only) rather than every category — a deliberate simplification (see spec's Open Assumptions): jobs already assigned to a since-deactivated category still appear in the unfiltered list, they just aren't filterable by that specific category through this dropdown.

- [ ] **Step 3: Add the two Server Actions**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { cancelJob } from '@/lib/services/admin-jobs'
import { cancelJobAndRefund } from '@/lib/services/refunds'
import { toSafeErrorMessage } from '@/lib/errors'

export async function cancelJobAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJob(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/jobs')
  revalidatePath(`/admin/jobs/${jobId}`)
  return { success: true }
}

export async function cancelJobAndRefundAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJobAndRefund(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/jobs')
  revalidatePath(`/admin/jobs/${jobId}`)
  revalidatePath('/admin/payments')
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}
```

Per the spec (§3.4): this file calls `cancelJobAndRefund` directly from `lib/services/refunds.ts` — not `app/admin/payments/actions.ts`'s own `cancelJobAndRefundAction` — so this route's `revalidatePath` calls stay independent of the payments page's.

- [ ] **Step 4: Create the shared cancel form**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type CancelAction = (
  jobId: string,
  reason: string
) => Promise<{ success: true } | { success: false; message: string }>

export function CancelJobForm({
  jobId,
  action,
  label,
}: {
  jobId: string
  action: CancelAction
  label: string
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleCancel() {
    setError(null)
    if (reason.trim().length === 0) {
      setError('Alasan pembatalan wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = await action(jobId, reason)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <span className="text-sm font-medium">Batalkan Pekerjaan</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Alasan Pembatalan</Label>
        <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" disabled={isPending} onClick={handleCancel}>
        {isPending ? 'Memproses...' : label}
      </Button>
    </div>
  )
}
```

- [ ] **Step 5: Create the detail page**

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getJobDetailForAdmin } from '@/lib/services/admin-jobs'
import { cancelJobAction, cancelJobAndRefundAction } from '../actions'
import { CancelJobForm } from './cancel-job-form'

export default async function AdminJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const job = await getJobDetailForAdmin(id)
  if (!job) {
    notFound()
  }

  const isCancellable = job.status !== 'cancelled' && job.status !== 'completed'
  const needsRefundPath = job.paymentStatus === 'verified'

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{job.title}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Kategori</dt>
          <dd>{job.categoryName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Employer</dt>
          <dd>{job.employerName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Worker</dt>
          <dd>{job.assignedWorkerName ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
        {job.paymentStatus && (
          <div>
            <dt className="text-muted-foreground">Status Pembayaran</dt>
            <dd>{job.paymentStatus}</dd>
          </div>
        )}
        {job.cancelledReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Pembatalan</dt>
            <dd>{job.cancelledReason}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">Nominal Pembayaran</dt>
          <dd>Rp{job.paymentAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Alamat</dt>
          <dd>{job.address}</dd>
        </div>
      </dl>
      <Link href={`/jobs/${job.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
        Lihat Halaman Publik
      </Link>
      {isCancellable && needsRefundPath && (
        <CancelJobForm jobId={job.id} action={cancelJobAndRefundAction} label="Batalkan & Mulai Refund" />
      )}
      {isCancellable && !needsRefundPath && (
        <CancelJobForm jobId={job.id} action={cancelJobAction} label="Batalkan Pekerjaan" />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean; route list includes `/admin/jobs` and `/admin/jobs/[id]`.

- [ ] **Step 7: Commit**

```bash
git add app/admin/jobs
git commit -m "feat(admin): add job management list, detail, and cancellation pages"
```

---

### Task 4: Admin Category Management service layer

**Files:**
- Modify: `lib/services/job-categories.ts` (add to the existing file — do not touch `getActiveJobCategories`)

**Interfaces:**
- Consumes: `create_job_category`, `update_job_category`, `set_job_category_active` RPCs (Task 1).
- Produces: `AdminJobCategory`, `getAllJobCategoriesForAdmin(): Promise<AdminJobCategory[]>`, `createJobCategory(name): Promise<{id: string}>`, `updateJobCategory(id, name): Promise<void>`, `setJobCategoryActive(id, isActive): Promise<void>` — consumed by Task 5's pages/actions.

- [ ] **Step 1: Add the new functions to `lib/services/job-categories.ts`**

Add these imports to the top of the existing file (alongside the existing `import { createClient } from '@/lib/supabase/server'`):

```ts
import { requireRole } from '@/lib/auth/get-current-user'
import { appError } from '@/lib/errors'
```

Append (after the existing `getActiveJobCategories`, unchanged):

```ts
export interface AdminJobCategory {
  id: string
  name: string
  isActive: boolean
}

export async function getAllJobCategoriesForAdmin(): Promise<AdminJobCategory[]> {
  await requireRole('admin')
  const supabase = await createClient()
  const { data, error } = await supabase.from('job_categories').select('id, name, is_active').order('name')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }))
}

function mapCategoryError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Nama kategori sudah digunakan.')
  }
  return appError('INTERNAL_ERROR')
}

export async function createJobCategory(name: string): Promise<{ id: string }> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_job_category', { p_name: name })

  if (error) {
    throw mapCategoryError(error.message)
  }

  return { id: data as string }
}

export async function updateJobCategory(id: string, name: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('update_job_category', { p_id: id, p_name: name })

  if (error) {
    throw mapCategoryError(error.message)
  }
}

export async function setJobCategoryActive(id: string, isActive: boolean): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('set_job_category_active', { p_id: id, p_is_active: isActive })

  if (error) {
    throw mapCategoryError(error.message)
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/services/job-categories.ts
git commit -m "feat(admin): add category management service functions"
```

---

### Task 5: Admin Category Management UI

**Files:**
- Create: `app/admin/categories/page.tsx`, `app/admin/categories/category-form.tsx`, `app/admin/categories/toggle-active-button.tsx`, `app/admin/categories/actions.ts`, `app/admin/categories/new/page.tsx`, `app/admin/categories/[id]/page.tsx`

**Interfaces:**
- Consumes: `getAllJobCategoriesForAdmin`, `createJobCategory`, `updateJobCategory`, `setJobCategoryActive` (Task 4).

- [ ] **Step 1: Create the Server Actions**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createJobCategory, updateJobCategory, setJobCategoryActive } from '@/lib/services/job-categories'
import { toSafeErrorMessage } from '@/lib/errors'

export async function createCategoryAction(
  name: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await createJobCategory(name)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/categories')
  return { success: true }
}

export async function updateCategoryAction(
  id: string,
  name: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await updateJobCategory(id, name)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/categories')
  revalidatePath(`/admin/categories/${id}`)
  return { success: true }
}

export async function toggleCategoryActiveAction(
  id: string,
  isActive: boolean
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await setJobCategoryActive(id, isActive)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/categories')
  return { success: true }
}
```

- [ ] **Step 2: Create the shared create/edit form**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCategoryAction, updateCategoryAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CategoryForm({ categoryId, initialName }: { categoryId?: string; initialName?: string }) {
  const [name, setName] = useState(initialName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit() {
    setError(null)
    if (name.trim().length === 0) {
      setError('Nama kategori wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = categoryId ? await updateCategoryAction(categoryId, name) : await createCategoryAction(name)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/categories')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nama Kategori</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" disabled={isPending} onClick={handleSubmit}>
        {isPending ? 'Menyimpan...' : categoryId ? 'Simpan Perubahan' : 'Tambah Kategori'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Create the activate/deactivate toggle button**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toggleCategoryActiveAction } from './actions'
import { Button } from '@/components/ui/button'

export function ToggleActiveButton({ categoryId, isActive }: { categoryId: string; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await toggleCategoryActiveAction(categoryId, !isActive)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
        {isPending ? '...' : isActive ? 'Nonaktifkan' : 'Aktifkan'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Create the list page**

```tsx
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAllJobCategoriesForAdmin } from '@/lib/services/job-categories'
import { ToggleActiveButton } from './toggle-active-button'

export default async function AdminCategoriesPage() {
  await requireAdminOr404()
  const categories = await getAllJobCategoriesForAdmin()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kategori Pekerjaan</h1>
        <Link href="/admin/categories/new" className="text-sm text-primary underline-offset-4 hover:underline">
          Tambah Kategori
        </Link>
      </div>
      {categories.length === 0 && <p className="text-sm text-muted-foreground">Belum ada kategori.</p>}
      <ul className="flex flex-col gap-2">
        {categories.map((category) => (
          <li key={category.id} className="flex items-center justify-between rounded border p-3 text-sm">
            <div className="flex flex-col">
              <span className="font-medium">{category.name}</span>
              <span className="text-muted-foreground">{category.isActive ? 'Aktif' : 'Nonaktif'}</span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/admin/categories/${category.id}`}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Edit
              </Link>
              <ToggleActiveButton categoryId={category.id} isActive={category.isActive} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Create the "new category" and "edit category" pages**

```tsx
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { CategoryForm } from '../category-form'

export default async function NewCategoryPage() {
  await requireAdminOr404()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Tambah Kategori</h1>
      <CategoryForm />
    </div>
  )
}
```

Save the above as `app/admin/categories/new/page.tsx`.

```tsx
import { notFound } from 'next/navigation'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAllJobCategoriesForAdmin } from '@/lib/services/job-categories'
import { CategoryForm } from '../category-form'

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const categories = await getAllJobCategoriesForAdmin()
  const category = categories.find((c) => c.id === id)
  if (!category) {
    notFound()
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Edit Kategori</h1>
      <CategoryForm categoryId={category.id} initialName={category.name} />
    </div>
  )
}
```

Save the above as `app/admin/categories/[id]/page.tsx`. (Fetching the full list and finding one entry is deliberate here — the category count is a handful of rows per the seed data, so a dedicated single-row fetch function isn't worth adding.)

- [ ] **Step 6: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean; route list includes `/admin/categories`, `/admin/categories/new`, `/admin/categories/[id]`.

- [ ] **Step 7: Commit**

```bash
git add app/admin/categories
git commit -m "feat(admin): add category management pages"
```

---

### Task 6: Admin Settings

**Files:**
- Create: `lib/validations/platform-settings.ts`, `lib/services/admin-settings.ts`, `app/admin/settings/page.tsx`, `app/admin/settings/settings-form.tsx`, `app/admin/settings/actions.ts`

**Interfaces:**
- Consumes: `update_platform_setting` RPC (Task 1).
- Produces: `PlatformSettingsSchema`, `PlatformSettingsInput`, `getAllPlatformSettings()`, `updatePlatformSettings(input)` — used only within this task's own page/action, no other task depends on them.

- [ ] **Step 1: Create the validation schema**

```ts
import { z } from 'zod'

export const PlatformSettingsSchema = z.object({
  platformFeePercentage: z.coerce.number().min(0).max(100),
  platformFeePayer: z.enum(['employer', 'worker', 'split']),
  defaultJobRadiusKm: z.coerce.number().positive(),
  maxUploadSizeMb: z.coerce.number().positive(),
  allowedFileTypes: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((type) => type.trim())
        .filter(Boolean)
    )
    .pipe(z.array(z.string()).min(1, { error: 'Minimal satu tipe file harus diisi.' })),
  bankName: z.string().trim().min(1, { error: 'Nama bank wajib diisi.' }),
  bankAccountNumber: z.string().trim().min(1, { error: 'Nomor rekening wajib diisi.' }),
  bankAccountHolderName: z.string().trim().min(1, { error: 'Nama pemilik rekening wajib diisi.' }),
})

export type PlatformSettingsInput = z.infer<typeof PlatformSettingsSchema>
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { PlatformSettingsSchema } from './platform-settings'

const validInput = {
  platformFeePercentage: '10',
  platformFeePayer: 'employer',
  defaultJobRadiusKm: '10',
  maxUploadSizeMb: '5',
  allowedFileTypes: 'image/jpeg, image/png, application/pdf',
  bankName: 'Bank Central Asia',
  bankAccountNumber: '1234567890',
  bankAccountHolderName: 'PT Paruh Waktu',
}

describe('PlatformSettingsSchema', () => {
  it('accepts a fully valid input and parses allowedFileTypes into an array', () => {
    const result = PlatformSettingsSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.allowedFileTypes).toEqual(['image/jpeg', 'image/png', 'application/pdf'])
      expect(result.data.platformFeePercentage).toBe(10)
    }
  })

  it('rejects a platformFeePercentage above 100', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, platformFeePercentage: '150' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid platformFeePayer', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, platformFeePayer: 'admin' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive defaultJobRadiusKm', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, defaultJobRadiusKm: '0' })
    expect(result.success).toBe(false)
  })

  it('rejects a non-positive maxUploadSizeMb', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, maxUploadSizeMb: '-1' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank allowedFileTypes', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, allowedFileTypes: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank bankName', () => {
    const result = PlatformSettingsSchema.safeParse({ ...validInput, bankName: '   ' })
    expect(result.success).toBe(false)
  })
})
```

Save as `lib/validations/platform-settings.test.ts`.

- [ ] **Step 3: Run the tests to verify they pass**

```bash
npx vitest run lib/validations/platform-settings.test.ts
```

Expected: all 7 tests pass (this schema has no implementation step separate from Step 1 — the schema and the test are written together, same as every other validation file in this codebase).

- [ ] **Step 4: Create `lib/services/admin-settings.ts`**

```ts
import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import type { PlatformSettingsInput } from '@/lib/validations/platform-settings'

export async function getAllPlatformSettings(): Promise<PlatformSettingsInput> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data, error } = await supabase.from('platform_settings').select('key, value')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const valueByKey = new Map((data ?? []).map((row) => [row.key, row.value]))

  const bankAccount = (valueByKey.get('admin_bank_account') ?? {}) as {
    bank_name?: string
    account_number?: string
    account_holder_name?: string
  }

  return {
    platformFeePercentage: Number(valueByKey.get('platform_fee_percentage') ?? 0),
    platformFeePayer: (valueByKey.get('platform_fee_payer') ?? 'employer') as 'employer' | 'worker' | 'split',
    defaultJobRadiusKm: Number(valueByKey.get('default_job_radius_km') ?? 10),
    maxUploadSizeMb: Number(valueByKey.get('max_upload_size_mb') ?? 5),
    allowedFileTypes: (valueByKey.get('allowed_file_types') ?? []) as string[],
    bankName: bankAccount.bank_name ?? '',
    bankAccountNumber: bankAccount.account_number ?? '',
    bankAccountHolderName: bankAccount.account_holder_name ?? '',
  }
}

function mapUpdateSettingError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  return appError('INTERNAL_ERROR')
}

export async function updatePlatformSettings(input: PlatformSettingsInput): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const updates: { key: string; value: unknown }[] = [
    { key: 'platform_fee_percentage', value: input.platformFeePercentage },
    { key: 'platform_fee_payer', value: input.platformFeePayer },
    { key: 'default_job_radius_km', value: input.defaultJobRadiusKm },
    { key: 'max_upload_size_mb', value: input.maxUploadSizeMb },
    { key: 'allowed_file_types', value: input.allowedFileTypes },
    {
      key: 'admin_bank_account',
      value: {
        bank_name: input.bankName,
        account_number: input.bankAccountNumber,
        account_holder_name: input.bankAccountHolderName,
      },
    },
  ]

  for (const update of updates) {
    const { error } = await supabase.rpc('update_platform_setting', {
      p_key: update.key,
      p_value: update.value,
    })
    if (error) {
      throw mapUpdateSettingError(error.message)
    }
  }
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Create the Server Action**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { updatePlatformSettings } from '@/lib/services/admin-settings'
import { PlatformSettingsSchema } from '@/lib/validations/platform-settings'
import { toSafeErrorMessage } from '@/lib/errors'

export type UpdateSettingsFormState =
  | {
      errors?: Record<string, string[]>
      message?: string
      success?: true
    }
  | undefined

export async function updateSettingsAction(
  _prevState: UpdateSettingsFormState,
  formData: FormData
): Promise<UpdateSettingsFormState> {
  const parsed = PlatformSettingsSchema.safeParse({
    platformFeePercentage: formData.get('platformFeePercentage'),
    platformFeePayer: formData.get('platformFeePayer'),
    defaultJobRadiusKm: formData.get('defaultJobRadiusKm'),
    maxUploadSizeMb: formData.get('maxUploadSizeMb'),
    allowedFileTypes: formData.get('allowedFileTypes'),
    bankName: formData.get('bankName'),
    bankAccountNumber: formData.get('bankAccountNumber'),
    bankAccountHolderName: formData.get('bankAccountHolderName'),
  })

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  }

  try {
    await updatePlatformSettings(parsed.data)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/settings')
  return { success: true }
}
```

- [ ] **Step 7: Create the settings form**

```tsx
'use client'

import { useActionState } from 'react'
import { updateSettingsAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PlatformSettingsInput } from '@/lib/validations/platform-settings'

export function SettingsForm({ initial }: { initial: PlatformSettingsInput }) {
  const [state, formAction, pending] = useActionState(updateSettingsAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded border p-3">
        <span className="text-sm font-medium">Pembayaran</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platformFeePercentage">Platform Fee (%)</Label>
          <Input
            id="platformFeePercentage"
            name="platformFeePercentage"
            type="number"
            step="0.01"
            defaultValue={initial.platformFeePercentage}
          />
          {state?.errors?.platformFeePercentage && (
            <p className="text-sm text-destructive">{state.errors.platformFeePercentage[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platformFeePayer">Fee Payer</Label>
          <select
            id="platformFeePayer"
            name="platformFeePayer"
            defaultValue={initial.platformFeePayer}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="employer">Employer</option>
            <option value="worker">Worker</option>
            <option value="split">Split</option>
          </select>
          {state?.errors?.platformFeePayer && (
            <p className="text-sm text-destructive">{state.errors.platformFeePayer[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bankName">Nama Bank</Label>
          <Input id="bankName" name="bankName" defaultValue={initial.bankName} />
          {state?.errors?.bankName && <p className="text-sm text-destructive">{state.errors.bankName[0]}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bankAccountNumber">Nomor Rekening</Label>
          <Input id="bankAccountNumber" name="bankAccountNumber" defaultValue={initial.bankAccountNumber} />
          {state?.errors?.bankAccountNumber && (
            <p className="text-sm text-destructive">{state.errors.bankAccountNumber[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bankAccountHolderName">Atas Nama</Label>
          <Input
            id="bankAccountHolderName"
            name="bankAccountHolderName"
            defaultValue={initial.bankAccountHolderName}
          />
          {state?.errors?.bankAccountHolderName && (
            <p className="text-sm text-destructive">{state.errors.bankAccountHolderName[0]}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded border p-3">
        <span className="text-sm font-medium">Pekerjaan</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="defaultJobRadiusKm">Radius Default (km)</Label>
          <Input
            id="defaultJobRadiusKm"
            name="defaultJobRadiusKm"
            type="number"
            step="0.1"
            defaultValue={initial.defaultJobRadiusKm}
          />
          {state?.errors?.defaultJobRadiusKm && (
            <p className="text-sm text-destructive">{state.errors.defaultJobRadiusKm[0]}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded border p-3">
        <span className="text-sm font-medium">Upload</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="maxUploadSizeMb">Ukuran Maksimal (MB)</Label>
          <Input
            id="maxUploadSizeMb"
            name="maxUploadSizeMb"
            type="number"
            step="0.1"
            defaultValue={initial.maxUploadSizeMb}
          />
          {state?.errors?.maxUploadSizeMb && (
            <p className="text-sm text-destructive">{state.errors.maxUploadSizeMb[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="allowedFileTypes">Tipe File yang Diizinkan (pisahkan dengan koma)</Label>
          <Input id="allowedFileTypes" name="allowedFileTypes" defaultValue={initial.allowedFileTypes.join(', ')} />
          {state?.errors?.allowedFileTypes && (
            <p className="text-sm text-destructive">{state.errors.allowedFileTypes[0]}</p>
          )}
        </div>
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      {state?.success && <p className="text-sm text-green-600">Pengaturan berhasil disimpan.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan Pengaturan'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 8: Create the page**

```tsx
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAllPlatformSettings } from '@/lib/services/admin-settings'
import { SettingsForm } from './settings-form'

export default async function AdminSettingsPage() {
  await requireAdminOr404()
  const initial = await getAllPlatformSettings()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pengaturan Platform</h1>
      <SettingsForm initial={initial} />
    </div>
  )
}
```

- [ ] **Step 9: Typecheck, lint, build, full test suite**

```bash
npx tsc --noEmit
npx eslint .
npm run build
npx vitest run
```

Expected: all clean; test count is 73 (Phase 9 baseline) + 7 (this task's new tests) = 80.

- [ ] **Step 10: Commit**

```bash
git add lib/validations/platform-settings.ts lib/validations/platform-settings.test.ts lib/services/admin-settings.ts app/admin/settings
git commit -m "feat(admin): add platform settings page, including admin bank account"
```

---

### Task 7: Audit Log Viewing

**Files:**
- Create: `lib/services/audit-logs.ts`, `app/admin/audit-logs/page.tsx`

**Interfaces:**
- Produces: `AuditLogEntry`, `getAuditLogsForAdmin(): Promise<AuditLogEntry[]>` — used only by this task's own page.

- [ ] **Step 1: Create `lib/services/audit-logs.ts`**

```ts
import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface AuditLogEntry {
  id: string
  actorName: string
  action: string
  entityType: string
  entityId: string | null
  description: string | null
  createdAt: string
}

export async function getAuditLogsForAdmin(): Promise<AuditLogEntry[]> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('id, actor_id, action, entity_type, entity_id, description, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = logs ?? []
  if (rows.length === 0) {
    return []
  }

  const actorIds = [...new Set(rows.filter((row) => row.actor_id).map((row) => row.actor_id as string))]
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', actorIds)

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  return rows.map((row) => ({
    id: row.id,
    actorName: row.actor_id ? (nameById.get(row.actor_id) ?? 'Tidak diketahui') : 'Sistem',
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    description: row.description,
    createdAt: row.created_at,
  }))
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Create the page**

```tsx
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAuditLogsForAdmin } from '@/lib/services/audit-logs'

export default async function AdminAuditLogsPage() {
  await requireAdminOr404()
  const logs = await getAuditLogsForAdmin()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Log Aktivitas</h1>
      {logs.length === 0 && <p className="text-sm text-muted-foreground">Belum ada aktivitas tercatat.</p>}
      <ul className="flex flex-col gap-2">
        {logs.map((log) => (
          <li key={log.id} className="flex flex-col gap-1 rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{log.action}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(log.createdAt).toLocaleString('id-ID')}
              </span>
            </div>
            <span className="text-muted-foreground">
              {log.actorName} &middot; {log.entityType}
              {log.entityId ? ` (${log.entityId})` : ''}
            </span>
            {log.description && <span>{log.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean; route list includes `/admin/audit-logs`.

- [ ] **Step 5: Commit**

```bash
git add lib/services/audit-logs.ts app/admin/audit-logs
git commit -m "feat(admin): add audit log viewing page"
```

---

### Task 8: Phase 11 Definition-of-Done verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be 80 (73 + this phase's 7 new `PlatformSettingsSchema` tests).

- [ ] **Step 2: Create test data**

Create 1 employer + 1 worker account (`phase11-employer@example.com`, `phase11-worker@example.com`, password `password1`), an admin account if one isn't already available for testing, and at least two jobs: one left at `open` (no payment yet), one driven to `payments.status = 'verified'` via the existing RPC/service chain (same pattern as Phase 10's own verification).

- [ ] **Step 3: Verify Admin Job Management**

1. Visit `/admin/jobs` as admin — confirm both test jobs appear; confirm search (by partial title) and filters (status, category) each narrow the list correctly.
2. Visit `/admin/jobs/[id]` for the `open` job — confirm it shows the plain "Batalkan Pekerjaan" action (not the refund one). Click it, submit a reason. Confirm directly against the DB: `jobs.status = 'cancelled'`, `jobs.cancelled_reason` matches, `job_assignments.status = 'cancelled'` if one existed, exactly one new `audit_logs` row (`JOB_CANCELLED`), and **no** `payments` row was created or touched.
3. Attempt `cancel_job` again on that now-cancelled job (direct RPC call) — confirm `CONFLICT: job already cancelled or completed`.
4. Attempt `cancel_job` (direct RPC call) on the job whose payment is `verified` — confirm `CONFLICT: use cancel_job_and_refund`.
5. Visit `/admin/jobs/[id]` for the verified-payment job — confirm it shows "Batalkan & Mulai Refund" instead (the refund path), and that clicking it still works exactly as it did in Phase 10 (job → `cancelled`, payment → `refund_pending`).
6. Attempt `cancel_job_and_refund` again on that now-cancelled job — confirm it now also fails with `CONFLICT: job already cancelled or completed` (the Task 1 hardening fix), not the old `payment not verified` message alone.

- [ ] **Step 4: Verify Admin Category Management**

1. Visit `/admin/categories` — confirm the existing seed categories appear.
2. Create a new category via `/admin/categories/new` — confirm it appears in the list as active.
3. Attempt to create a second category with the exact same name — confirm a `CONFLICT` error is shown, no duplicate row created.
4. Edit the new category's name via `/admin/categories/[id]` — confirm the rename persists.
5. Deactivate it via the list page's toggle — confirm `is_active = false` in the DB, and confirm it no longer appears in `getActiveJobCategories()`'s result (e.g. it's gone from the `/jobs` browse page's category filter) while still appearing in `/admin/categories`'s own list.
6. Re-activate it — confirm it reappears in both places.

- [ ] **Step 5: Verify Admin Settings**

1. Visit `/admin/settings` — confirm all 6 fields are pre-filled with the current `platform_settings` values (bank account fields will show the placeholder "BELUM DIATUR" values until this step changes them).
2. Submit the form with new values for every field, including a real bank name/account number/account holder name.
3. Confirm directly against the DB: all 6 `platform_settings` rows updated (`value`, `updated_at`, `updated_by`), and 6 new `audit_logs` rows (`PLATFORM_SETTING_UPDATED`) — one per key.
4. Reload `/admin/settings` — confirm the form now shows the newly-saved values.
5. Visit `/jobs/[id]/payment` for any job with a payment — confirm the "Rekening tujuan belum dikonfigurasi" message is gone and the real bank account details now display.
6. Submit the form with an invalid value (e.g. `platformFeePercentage = 150`) — confirm a client-visible validation error and that no RPC call was made (the pre-existing valid settings remain unchanged).

- [ ] **Step 6: Verify Audit Log**

Visit `/admin/audit-logs` — confirm every action from Steps 3-5 above appears (in reverse-chronological order), each showing the correct actor name, action, entity type/id, and description, alongside entries from earlier phases (e.g. `USER_SUSPENDED` from Phase 10's own testing, if any residual rows exist — otherwise just confirm the shape is correct with this task's own fresh entries).

- [ ] **Step 7: Clean up all test data**

Delete in FK-safe order: the new category created in Step 4 (if not already cleaned via the test itself) → `audit_logs` rows created by this verification → `payments` → `job_applications`/`job_assignments` → `jobs` → `user_roles` → `profiles` → `auth.users`. Verify zero leftovers afterward. Leave `platform_settings` at whatever real values were configured in Step 5 (these are meant to persist — reverting them would undo the point of this phase).

- [ ] **Step 8: Report results**

Note clearly which of Steps 3-6's checks passed, with what was actually observed (not just "pass") — mirroring every prior phase's verification report format. If any fail, do not mark Phase 11 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 11 Definition of Done

- [ ] Admin can browse, search, and filter every job at `/admin/jobs`, and view full detail (employer, worker, category, status, payment status if any) at `/admin/jobs/[id]`.
- [ ] Admin can cancel any non-terminal job: `cancel_job` for one with no verified payment, `cancel_job_and_refund` for one with a verified payment — the correct one is chosen automatically, and both reject a second cancellation attempt.
- [ ] Admin can create, rename, activate, and deactivate job categories at `/admin/categories`; a duplicate name is rejected with `CONFLICT`; `getActiveJobCategories()` (and everything that depends on it) is unaffected in shape or behavior.
- [ ] Admin can view and update all 6 platform settings at `/admin/settings`, including — for the first time — the admin bank account, which then actually appears on the employer payment page.
- [ ] `/admin/audit-logs` lists every audit log entry with actor name, action, entity, description, and timestamp, including everything written by this phase's own new RPCs.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run` (80 tests), and `npm run build` all pass.
- [ ] Steps 3-6's checks in Task 8 were genuinely executed against the real DB/RPCs and the UI, not attested to from code review.
