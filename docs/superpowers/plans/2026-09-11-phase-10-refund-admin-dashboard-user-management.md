# Phase 10 (Refund, Admin Dashboard & Admin User Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Admin cancel a job with a verified payment and manually refund the employer (with proof), view an operational dashboard, and view/search/suspend/activate users.

**Architecture:** One new migration adds two `payments` status values + refund columns, a `refund-proofs` storage bucket, and four `SECURITY DEFINER` RPCs (`cancel_job_and_refund`, `mark_refund_paid`, `suspend_user`, `activate_user`) — mirroring this codebase's existing withdrawal-processing RPC shape exactly. `getCurrentUser()` gains one added check so a suspended user is treated as logged out everywhere at once, with no new middleware. The dashboard is a single read-only aggregation page using the existing auth-context client (every count is already reachable through existing `is_admin()`-inclusive RLS).

**Tech Stack:** Next.js (Server Components + Server Actions), Supabase (Postgres, RLS, Storage, `SECURITY DEFINER` RPCs), Zod (unchanged — no new schema this phase), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-refund-and-admin-management-design.md`

## Global Constraints

- Every new RPC: `language plpgsql`, `security definer`, `set search_path = ''`, an `is_admin()` check as its first line, row locking via `for update` before reading a status this RPC will branch on, an `audit_logs` insert, and `revoke execute on function ... from public, anon, service_role; grant execute on function ... to authenticated;` — copy this shape from `supabase/migrations/20260910041646_withdrawal_flow.sql`'s `process_withdrawal`/`mark_withdrawal_paid`, do not invent a different shape.
- A refund is refundable exactly when `payments.status = 'verified' AND jobs.status <> 'completed'` — nothing else. See spec §4.1 for why these two conditions are sufficient without enumerating job statuses.
- No `wallet_transactions` row is ever written for a job refund — employers have no wallet in this schema (spec §6.1). The `payments` row itself (via `jobs.cancelled_reason`, `payments.refund_transfer_proof_path`, `payments.refunded_at`) is the recorded transaction.
- `profiles.account_status`, along with `phone`/`address`/`latitude`/`longitude`, is **not readable via the ordinary auth-context client at all** (`supabase/migrations/20260907120918_profiles_column_grant_restriction.sql` revoked the whole-table grant and re-granted only `id, full_name, avatar_url, created_at, updated_at`). Every read of `account_status` — in `getCurrentUser()`, in the admin user list/detail — must go through `createServiceClient()` (`lib/supabase/service.ts`).
- Suspend/activate carry no reason field (spec §2 — PRD §33 names none). An admin can never suspend their own account (`suspend_user`'s self-guard).
- No new Zod validation schema this phase (spec §8) — the refund reason is a plain required non-empty string handled inline in its client component, exactly like `ProcessRejectForm`'s existing `rejectionReason` handling; the refund proof file is validated inline exactly like `markWithdrawalPaidAction`'s existing file checks.
- No pagination anywhere added this phase — matches every existing admin list page.

---

### Task 1: Database migration — refund schema/RPCs, suspend/activate RPCs

**Files:**
- Create: `supabase/migrations/<timestamp>_refund_and_admin_management.sql`
- Modify: `lib/supabase/database.types.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `public.cancel_job_and_refund(p_job_id uuid, p_reason text) returns void`, `public.mark_refund_paid(p_payment_id uuid, p_transfer_proof_path text) returns void`, `public.suspend_user(p_user_id uuid) returns void`, `public.activate_user(p_user_id uuid) returns void` — all consumed by Task 2 (refund RPCs) and Task 5 (suspend/activate RPCs).
- Produces: `payments.status` now also allows `'refund_pending'` and `'refunded'`; new columns `payments.refunded_by`, `payments.refund_transfer_proof_path`, `payments.refunded_at` — consumed by Task 2.
- Produces: storage bucket `refund-proofs`, folder-scoped by `payments.id` — consumed by Task 2's `markRefundPaid`.
- Consumes: `public.is_admin()` (`supabase/migrations/20260907115904_fix_is_admin_security_definer_and_wrapping.sql`), `public.audit_logs`, `public.jobs.cancelled_reason` (already exists, dead until now), `public.job_assignments.status = 'cancelled'` (already exists, dead until now).

- [ ] **Step 1: Re-link and verify the Supabase CLI**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
npx supabase migration list
```

Expected: every migration through `20260910141626_fix_conversation_participants_read_marking.sql` shows applied on both `Local` and `Remote`. If anything is missing from Remote, stop and investigate before continuing.

- [ ] **Step 2: Create the migration file**

```bash
npx supabase migration new refund_and_admin_management
```

Note the generated filename (e.g. `supabase/migrations/20260911120000_refund_and_admin_management.sql`) — edit that exact file in the next step.

- [ ] **Step 3: Write the migration**

Replace the file's contents with:

```sql
-- Refund (PRD §29): Admin cancels a job whose payment is already verified
-- but not yet completed, then records the manual transfer back to the
-- employer. No wallet_transactions row -- employers have no wallet in
-- this schema; the payments row itself is the recorded transaction.

alter table public.payments
  add column refunded_by uuid references public.profiles (id),
  add column refund_transfer_proof_path text,
  add column refunded_at timestamptz;

-- payments.status had no explicit constraint name in its original inline
-- `check (...)`, so Postgres auto-named it <table>_<column>_check. If
-- this DROP fails with "constraint does not exist", find the actual name
-- via the Supabase dashboard's Table Editor > payments > a failed
-- migration's error message names the real constraint -- then substitute
-- it below and re-run.
alter table public.payments
  drop constraint payments_status_check,
  add constraint payments_status_check check (
    status in (
      'waiting_payment', 'waiting_verification', 'verified', 'rejected',
      'refund_pending', 'refunded'
    )
  );

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

  if v_job_status = 'completed' then
    raise exception 'CONFLICT: job already completed';
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

revoke execute on function public.cancel_job_and_refund from public, anon, service_role;
grant execute on function public.cancel_job_and_refund to authenticated;

create or replace function public.mark_refund_paid(p_payment_id uuid, p_transfer_proof_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'refund_pending' then
    raise exception 'CONFLICT: refund not pending';
  end if;

  if p_transfer_proof_path not like p_payment_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside payment folder';
  end if;

  update public.payments
  set status = 'refunded',
      refund_transfer_proof_path = p_transfer_proof_path,
      refunded_by = (select auth.uid()),
      refunded_at = now()
  where id = p_payment_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'REFUND_PAID', 'payment', p_payment_id, null);
end;
$$;

revoke execute on function public.mark_refund_paid from public, anon, service_role;
grant execute on function public.mark_refund_paid to authenticated;

-- Admin User Management (PRD §33): suspend/activate. profiles.account_status
-- already exists (Phase 1) but nothing has ever written to it -- these are
-- the first writers. Kept as RPCs (not a bare service-role .update()) so
-- every privileged state change in this app keeps writing audit_logs from
-- inside the same transaction, same as every RPC above.
create or replace function public.suspend_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'FORBIDDEN: cannot suspend own account';
  end if;

  update public.profiles set account_status = 'suspended' where id = p_user_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'USER_SUSPENDED', 'profile', p_user_id, null);
end;
$$;

revoke execute on function public.suspend_user from public, anon, service_role;
grant execute on function public.suspend_user to authenticated;

create or replace function public.activate_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.profiles set account_status = 'active' where id = p_user_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'USER_ACTIVATED', 'profile', p_user_id, null);
end;
$$;

revoke execute on function public.activate_user from public, anon, service_role;
grant execute on function public.activate_user to authenticated;

-- refund-proofs storage bucket: private, admin-only upload, readable by
-- the payment's own employer or an admin -- copied verbatim from
-- withdrawal-proofs' shape (supabase/migrations/20260907102700_storage_buckets.sql),
-- substituting payments/employer_id for withdrawals/user_id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('refund-proofs', 'refund-proofs', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "refund_proofs_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'refund-proofs'
  and (
    exists (
      select 1 from public.payments p
      where p.id::text = (storage.foldername(name))[1]
      and p.employer_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

create policy "refund_proofs_insert_admin_only"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'refund-proofs'
  and public.is_admin()
);
```

- [ ] **Step 4: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`. If the `drop constraint payments_status_check` statement fails, the error names the real constraint — edit the file to use that name and re-run (the whole file re-applies cleanly; nothing partial was committed by the failed attempt).

- [ ] **Step 5: Verify**

```bash
npx supabase migration list
```

Expected: the new migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 6: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: diff shows the four new functions under `public.Functions`, and `payments` gaining the three new nullable columns and the widened `status` union. `storage.buckets` types are not affected (buckets aren't in generated app types).

- [ ] **Step 7: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Tasks 2 and 5).

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add refund RPCs, storage bucket, and suspend/activate RPCs"
```

---

### Task 2: Refund service layer

**Files:**
- Create: `lib/services/refunds.ts`
- Modify: `lib/services/payments.ts:7-43` (add fields to `PaymentDetail`/`PaymentRow`/`mapPaymentRow`), `lib/services/payments.ts:192-252` (`AdminPaymentDetail` + `getPaymentDetailForAdmin`)

**Interfaces:**
- Consumes: `cancel_job_and_refund`, `mark_refund_paid` RPCs (Task 1).
- Produces: `cancelJobAndRefund(jobId: string, reason: string): Promise<void>`, `markRefundPaid(paymentId: string, file: File): Promise<void>` — consumed by Task 3's Server Actions.
- Produces: `AdminPaymentDetail` gains `jobStatus: string`, `refundTransferProofPath: string | null`, `refundedAt: string | null` — consumed by Task 3's page.

- [ ] **Step 1: Add the new fields to the shared payment row/mapper**

In `lib/services/payments.ts`, modify the `PaymentDetail` interface, `PaymentRow` interface, and `mapPaymentRow` function (lines 7-43) to:

```ts
export interface PaymentDetail {
  id: string
  jobId: string
  amount: number
  platformFee: number
  totalAmount: number
  feePayer: string
  status: string
  transferDate: string | null
  rejectionReason: string | null
  refundTransferProofPath: string | null
  refundedAt: string | null
}

interface PaymentRow {
  id: string
  job_id: string
  amount: number
  platform_fee: number
  total_amount: number
  fee_payer: string
  status: string
  transfer_date: string | null
  rejection_reason: string | null
  refund_transfer_proof_path: string | null
  refunded_at: string | null
}

function mapPaymentRow(row: PaymentRow): PaymentDetail {
  return {
    id: row.id,
    jobId: row.job_id,
    amount: row.amount,
    platformFee: row.platform_fee,
    totalAmount: row.total_amount,
    feePayer: row.fee_payer,
    status: row.status,
    transferDate: row.transfer_date,
    rejectionReason: row.rejection_reason,
    refundTransferProofPath: row.refund_transfer_proof_path,
    refundedAt: row.refunded_at,
  }
}
```

- [ ] **Step 2: Add the two new columns to every `.select()` that uses this row shape**

In `lib/services/payments.ts`, both `getPaymentForJob` (the `.select(...)` call) and `getPaymentDetailForAdmin` (the `.select(...)` call for `payment`) must append `, refund_transfer_proof_path, refunded_at` to their existing column lists so `mapPaymentRow` receives every field it maps. Example for `getPaymentForJob`:

```ts
  const { data, error } = await supabase
    .from('payments')
    .select(
      'id, job_id, amount, platform_fee, total_amount, fee_payer, status, transfer_date, rejection_reason, refund_transfer_proof_path, refunded_at'
    )
    .eq('job_id', jobId)
    .maybeSingle()
```

Apply the same column addition to `getPaymentDetailForAdmin`'s `payment` select.

- [ ] **Step 3: Add `jobStatus` to `AdminPaymentDetail` and fetch it**

In `lib/services/payments.ts`, modify `AdminPaymentDetail` and `getPaymentDetailForAdmin` (lines 192-252):

```ts
export interface AdminPaymentDetail extends PaymentDetail {
  jobTitle: string
  jobStatus: string
  employerName: string
  proofs: { id: string; filePath: string; uploadedAt: string }[]
}

export async function getPaymentDetailForAdmin(paymentId: string): Promise<AdminPaymentDetail | null> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: payment, error } = await supabase
    .from('payments')
    .select(
      'id, job_id, employer_id, amount, platform_fee, total_amount, fee_payer, status, transfer_date, rejection_reason, refund_transfer_proof_path, refunded_at'
    )
    .eq('id', paymentId)
    .maybeSingle()

  if (error || !payment) {
    return null
  }

  const { data: job, error: jobError } = await supabase
    .from('jobs')
    .select('title, status')
    .eq('id', payment.job_id)
    .maybeSingle()
  if (jobError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', payment.employer_id)
    .maybeSingle()
  if (profileError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: proofs, error: proofsError } = await supabase
    .from('payment_proofs')
    .select('id, file_path, created_at')
    .eq('payment_id', paymentId)
    .order('created_at', { ascending: false })

  if (proofsError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    ...mapPaymentRow(payment),
    jobTitle: job?.title ?? 'Pekerjaan tidak diketahui',
    jobStatus: job?.status ?? 'unknown',
    employerName: profile?.full_name ?? 'Tidak diketahui',
    proofs: (proofs ?? []).map((proof) => ({
      id: proof.id,
      filePath: proof.file_path,
      uploadedAt: proof.created_at,
    })),
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Create `lib/services/refunds.ts`**

```ts
import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

function mapCancelJobAndRefundError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND', 'Pembayaran untuk pekerjaan ini tidak ditemukan.')
  }
  if (message.includes('payment not verified')) {
    return appError('CONFLICT', 'Pembayaran ini belum terverifikasi.')
  }
  if (message.includes('job already completed')) {
    return appError('CONFLICT', 'Pekerjaan ini sudah selesai dan tidak dapat dibatalkan.')
  }
  return appError('INTERNAL_ERROR')
}

export async function cancelJobAndRefund(jobId: string, reason: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('cancel_job_and_refund', {
    p_job_id: jobId,
    p_reason: reason,
  })

  if (error) {
    throw mapCancelJobAndRefundError(error.message)
  }
}

function mapMarkRefundPaidError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Refund ini belum siap untuk ditandai selesai.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function markRefundPaid(paymentId: string, file: File): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()
  const path = `${paymentId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('refund-proofs')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti transfer refund.')
  }

  const { error } = await supabase.rpc('mark_refund_paid', {
    p_payment_id: paymentId,
    p_transfer_proof_path: path,
  })

  if (error) {
    await supabase.storage.from('refund-proofs').remove([path])
    throw mapMarkRefundPaidError(error.message)
  }
}
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/services/refunds.ts lib/services/payments.ts
git commit -m "feat(refunds): add refund service layer and extend payment detail"
```

---

### Task 3: Refund admin UI + cancelled-job display

**Files:**
- Create: `app/admin/payments/[id]/cancel-refund-form.tsx`, `app/admin/payments/[id]/refund-proof-form.tsx`
- Modify: `app/admin/payments/[id]/page.tsx`, `app/admin/payments/actions.ts`
- Modify: `lib/services/jobs.ts:234-248` (`JobDetail`), `lib/services/jobs.ts:250-306` (`getJobDetail`)
- Modify: `app/jobs/[id]/page.tsx`

**Interfaces:**
- Consumes: `cancelJobAndRefund`, `markRefundPaid` (Task 2).
- Produces: `cancelJobAndRefundAction(jobId, reason)`, `markRefundPaidAction(paymentId, prevState, formData)` — Server Actions other tasks don't depend on.

- [ ] **Step 1: Add `cancelledReason` to `JobDetail`**

In `lib/services/jobs.ts`, modify the `JobDetail` interface (lines 234-248) to add one field:

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
}
```

- [ ] **Step 2: Select and return `cancelled_reason` in `getJobDetail`**

In `lib/services/jobs.ts`'s `getJobDetail` (lines 250-306), add `cancelled_reason` to the `.select(...)` column list and `cancelledReason: job.cancelled_reason` to the returned object:

```ts
  const { data: job, error } = await supabase
    .from('jobs')
    .select(
      'id, title, description, address, latitude, longitude, category_id, payment_amount, duration_minutes, deadline, status, employer_id, assigned_worker_id, cancelled_reason'
    )
    .eq('id', jobId)
    .maybeSingle()
```

and in the returned object at the end of the function:

```ts
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
    assignedWorkerId: job.assigned_worker_id,
    cancelledReason: job.cancelled_reason,
  }
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Show the cancellation reason on the job detail page**

In `app/jobs/[id]/page.tsx`, inside the existing `<dl>` block, add one more `<div>` right after the existing Status `<div>` (around line 60):

```tsx
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
        {job.status === 'cancelled' && job.cancelledReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Pembatalan</dt>
            <dd>{job.cancelledReason}</dd>
          </div>
        )}
```

No other change to this file — every other section (edit link, applicants link, payment link, completion link, chat link) already gates on specific statuses that don't include `'cancelled'`, so they correctly stop appearing once a job is cancelled; the chat link's own gate (`job.assignedWorkerId !== null`) is unaffected by status, matching spec §4.2 ("chat stays visible").

- [ ] **Step 5: Create `CancelRefundForm`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { cancelJobAndRefundAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CancelRefundForm({ jobId }: { jobId: string }) {
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
      const result = await cancelJobAndRefundAction(jobId, reason)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <span className="text-sm font-medium">Batalkan Pekerjaan &amp; Refund</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Alasan Pembatalan</Label>
        <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" disabled={isPending} onClick={handleCancel}>
        {isPending ? 'Memproses...' : 'Batalkan & Mulai Refund'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 6: Create `RefundProofForm`**

```tsx
'use client'

import { useActionState } from 'react'
import { markRefundPaidAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RefundProofForm({ paymentId }: { paymentId: string }) {
  const boundAction = markRefundPaidAction.bind(null, paymentId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded border p-3">
      <span className="text-sm font-medium">Unggah Bukti Transfer Refund</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Transfer</Label>
        <Input id="file" name="file" type="file" accept="image/jpeg,image/png,application/pdf" required />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Tandai Refund Selesai'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 7: Add the two Server Actions**

In `app/admin/payments/actions.ts`, add (keep the existing `reviewPaymentAction` untouched):

```ts
import { cancelJobAndRefund, markRefundPaid } from '@/lib/services/refunds'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export async function cancelJobAndRefundAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJobAndRefund(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}

export type MarkRefundPaidFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function markRefundPaidAction(
  paymentId: string,
  _prevState: MarkRefundPaidFormState,
  formData: FormData
): Promise<MarkRefundPaidFormState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti transfer wajib diunggah.'] } }
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { errors: { file: ['Format file harus JPEG, PNG, atau PDF.'] } }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { errors: { file: ['Ukuran file maksimal 10MB.'] } }
  }

  try {
    await markRefundPaid(paymentId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${paymentId}`)
  return undefined
}
```

The file's existing `import { revalidatePath } from 'next/cache'` and `import { toSafeErrorMessage } from '@/lib/errors'` already cover what these two new actions need — add only the one new import shown above (`cancelJobAndRefund, markRefundPaid`) plus the two constants, above the existing `reviewPaymentAction`.

- [ ] **Step 8: Wire the forms into the payment detail page**

In `app/admin/payments/[id]/page.tsx`, add imports for `CancelRefundForm` and `RefundProofForm`, and after the existing `{payment.status === 'waiting_verification' && <ReviewForm paymentId={payment.id} />}` line, add:

```tsx
      {payment.status === 'verified' && payment.jobStatus !== 'completed' && (
        <CancelRefundForm jobId={payment.jobId} />
      )}
      {payment.status === 'refund_pending' && <RefundProofForm paymentId={payment.id} />}
      {payment.status === 'refunded' && payment.refundTransferProofPath && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Bukti Refund</span>
          <span className="text-xs text-muted-foreground">
            Direfund {payment.refundedAt ? new Date(payment.refundedAt).toLocaleString('id-ID') : '-'}
          </span>
        </div>
      )}
```

- [ ] **Step 9: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add app/admin/payments app/jobs lib/services/jobs.ts
git commit -m "feat(admin): add refund cancellation and proof upload to payment review"
```

---

### Task 4: Admin Dashboard

**Files:**
- Create: `lib/services/admin-dashboard.ts`, `app/admin/page.tsx`

**Interfaces:**
- Produces: `getAdminDashboardStats(): Promise<AdminDashboardStats>` — used only by `app/admin/page.tsx`, no other task depends on it.

- [ ] **Step 1: Create `lib/services/admin-dashboard.ts`**

```ts
import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface AdminDashboardStats {
  totalUsers: number
  totalWorkers: number
  totalEmployers: number
  activeJobs: number
  completedJobs: number
  pendingPayments: number
  pendingWithdrawals: number
}

const ACTIVE_JOB_STATUSES = [
  'open',
  'assigned',
  'waiting_payment',
  'payment_review',
  'payment_verified',
  'in_progress',
  'waiting_confirmation',
]

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  await requireRole('admin')
  const supabase = await createClient()

  const [totalUsers, totalWorkers, totalEmployers, activeJobs, completedJobs, pendingPayments, pendingWithdrawals] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'worker'),
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'employer'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).in('status', ACTIVE_JOB_STATUSES),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'waiting_verification'),
      supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])

  const results = [totalUsers, totalWorkers, totalEmployers, activeJobs, completedJobs, pendingPayments, pendingWithdrawals]
  if (results.some((result) => result.error)) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    totalUsers: totalUsers.count ?? 0,
    totalWorkers: totalWorkers.count ?? 0,
    totalEmployers: totalEmployers.count ?? 0,
    activeJobs: activeJobs.count ?? 0,
    completedJobs: completedJobs.count ?? 0,
    pendingPayments: pendingPayments.count ?? 0,
    pendingWithdrawals: pendingWithdrawals.count ?? 0,
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Create `app/admin/page.tsx`**

```tsx
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAdminDashboardStats } from '@/lib/services/admin-dashboard'

export default async function AdminDashboardPage() {
  await requireAdminOr404()
  const stats = await getAdminDashboardStats()

  const tiles: { label: string; value: number }[] = [
    { label: 'Total Pengguna', value: stats.totalUsers },
    { label: 'Total Worker', value: stats.totalWorkers },
    { label: 'Total Employer', value: stats.totalEmployers },
    { label: 'Pekerjaan Aktif', value: stats.activeJobs },
    { label: 'Pekerjaan Selesai', value: stats.completedJobs },
    { label: 'Pembayaran Menunggu Verifikasi', value: stats.pendingPayments },
    { label: 'Withdrawal Menunggu Proses', value: stats.pendingWithdrawals },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Dashboard Admin</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 rounded border p-4">
            <span className="text-2xl font-semibold">{tile.value}</span>
            <span className="text-sm text-muted-foreground">{tile.label}</span>
          </div>
        ))}
      </div>
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

Expected: all clean; route list includes `/admin` as a dynamic (ƒ) route.

- [ ] **Step 5: Commit**

```bash
git add lib/services/admin-dashboard.ts app/admin/page.tsx
git commit -m "feat(admin): add admin dashboard with operational stats"
```

---

### Task 5: Admin User Management service layer

**Files:**
- Create: `lib/services/admin-users.ts`

**Interfaces:**
- Consumes: `suspend_user`, `activate_user` RPCs (Task 1).
- Produces: `AdminUserSummary`, `AdminUserFilters`, `getUsersForAdmin(filters?): Promise<AdminUserSummary[]>`, `AdminUserDetail`, `getUserDetailForAdmin(userId): Promise<AdminUserDetail | null>`, `suspendUser(userId): Promise<void>`, `activateUser(userId): Promise<void>` — consumed by Task 6's pages/actions.

- [ ] **Step 1: Create `lib/services/admin-users.ts`**

```ts
import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import type { AppRole } from '@/lib/auth/has-role'

export interface AdminUserSummary {
  id: string
  fullName: string
  email: string | null
  accountStatus: string
  roles: AppRole[]
  createdAt: string
}

export interface AdminUserFilters {
  search?: string
  role?: AppRole
  status?: 'active' | 'suspended'
}

export async function getUsersForAdmin(filters: AdminUserFilters = {}): Promise<AdminUserSummary[]> {
  await requireRole('admin')
  const supabase = createServiceClient()

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, account_status, created_at')
    .order('created_at', { ascending: false })

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: roleRows, error: rolesError } = await supabase.from('user_roles').select('user_id, role')

  if (rolesError) {
    throw appError('INTERNAL_ERROR')
  }

  const rolesById = new Map<string, AppRole[]>()
  for (const row of roleRows ?? []) {
    const roles = rolesById.get(row.user_id) ?? []
    roles.push(row.role as AppRole)
    rolesById.set(row.user_id, roles)
  }

  const {
    data: { users: authUsers },
    error: authError,
  } = await supabase.auth.admin.listUsers({ perPage: 1000 })

  if (authError) {
    throw appError('INTERNAL_ERROR')
  }

  const emailById = new Map(authUsers.map((authUser) => [authUser.id, authUser.email ?? null]))

  let rows: AdminUserSummary[] = (profiles ?? []).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: emailById.get(profile.id) ?? null,
    accountStatus: profile.account_status,
    roles: rolesById.get(profile.id) ?? [],
    createdAt: profile.created_at,
  }))

  if (filters.status) {
    rows = rows.filter((row) => row.accountStatus === filters.status)
  }
  if (filters.role) {
    const role = filters.role
    rows = rows.filter((row) => row.roles.includes(role))
  }
  if (filters.search) {
    const term = filters.search.toLowerCase()
    rows = rows.filter(
      (row) => row.fullName.toLowerCase().includes(term) || (row.email ?? '').toLowerCase().includes(term)
    )
  }

  return rows
}

export interface AdminUserDetail extends AdminUserSummary {
  latestVerificationId: string | null
}

export async function getUserDetailForAdmin(userId: string): Promise<AdminUserDetail | null> {
  await requireRole('admin')
  const supabase = createServiceClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, account_status, created_at')
    .eq('id', userId)
    .maybeSingle()

  if (error || !profile) {
    return null
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)

  if (rolesError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId)
  if (authError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: verification, error: verificationError } = await supabase
    .from('employer_verifications')
    .select('id')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (verificationError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: authUser.user?.email ?? null,
    accountStatus: profile.account_status,
    roles: (roleRows ?? []).map((row) => row.role as AppRole),
    createdAt: profile.created_at,
    latestVerificationId: verification?.id ?? null,
  }
}

function mapSuspendUserError(message: string): Error {
  if (message.includes('cannot suspend own account')) {
    return appError('FORBIDDEN', 'Anda tidak dapat menangguhkan akun Anda sendiri.')
  }
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  return appError('INTERNAL_ERROR')
}

export async function suspendUser(userId: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('suspend_user', { p_user_id: userId })

  if (error) {
    throw mapSuspendUserError(error.message)
  }
}

function mapActivateUserError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  return appError('INTERNAL_ERROR')
}

export async function activateUser(userId: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('activate_user', { p_user_id: userId })

  if (error) {
    throw mapActivateUserError(error.message)
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
git add lib/services/admin-users.ts
git commit -m "feat(admin): add admin user management service layer"
```

---

### Task 6: Admin User Management UI

**Files:**
- Create: `app/admin/users/page.tsx`, `app/admin/users/user-filters.tsx`, `app/admin/users/[id]/page.tsx`, `app/admin/users/actions.ts`

**Interfaces:**
- Consumes: `getUsersForAdmin`, `getUserDetailForAdmin`, `suspendUser`, `activateUser` (Task 5).

- [ ] **Step 1: Create the client-side filter component**

```tsx
'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function UserFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [role, setRole] = useState(searchParams.get('role') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')

  function applyFilters() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (role) params.set('role', role)
    if (status) params.set('status', status)
    router.push(`/admin/users?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Cari nama atau email..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Role</option>
          <option value="worker">Worker</option>
          <option value="employer">Employer</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="suspended">Suspended</option>
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
import { getUsersForAdmin } from '@/lib/services/admin-users'
import type { AppRole } from '@/lib/auth/has-role'
import { UserFilters } from './user-filters'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; role?: string; status?: string }>
}) {
  await requireAdminOr404()
  const { search, role, status } = await searchParams

  const users = await getUsersForAdmin({
    search,
    role: role as AppRole | undefined,
    status: status as 'active' | 'suspended' | undefined,
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pengguna</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <UserFilters />
      </Suspense>
      {users.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada pengguna ditemukan.</p>}
      <ul className="flex flex-col gap-2">
        {users.map((user) => (
          <li key={user.id}>
            <Link
              href={`/admin/users/${user.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col">
                <span className="font-medium">{user.fullName}</span>
                <span className="text-muted-foreground">{user.email ?? '-'}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span>{user.roles.join(', ') || '-'}</span>
                <span className="text-muted-foreground">{user.accountStatus}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Create the Server Actions**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { suspendUser, activateUser } from '@/lib/services/admin-users'
import { toSafeErrorMessage } from '@/lib/errors'

export async function suspendUserAction(
  userId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await suspendUser(userId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}

export async function activateUserAction(
  userId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await activateUser(userId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}
```

- [ ] **Step 4: Create the detail page**

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAdminOr404, getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserDetailForAdmin } from '@/lib/services/admin-users'
import { SuspendActivateButton } from './suspend-activate-button'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const user = await getUserDetailForAdmin(id)
  if (!user) {
    notFound()
  }

  const currentUser = await getCurrentUser()
  const isSelf = currentUser?.id === user.id

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{user.fullName}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{user.roles.join(', ') || '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status Akun</dt>
          <dd>{user.accountStatus}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bergabung</dt>
          <dd>{new Date(user.createdAt).toLocaleString('id-ID')}</dd>
        </div>
      </dl>
      {user.latestVerificationId && (
        <Link
          href={`/admin/employer-verifications/${user.latestVerificationId}`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Lihat Status Verifikasi Employer
        </Link>
      )}
      {!isSelf && <SuspendActivateButton userId={user.id} accountStatus={user.accountStatus} />}
    </div>
  )
}
```

- [ ] **Step 5: Create the suspend/activate button**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { suspendUserAction, activateUserAction } from '../actions'
import { Button } from '@/components/ui/button'

export function SuspendActivateButton({
  userId,
  accountStatus,
}: {
  userId: string
  accountStatus: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const action = accountStatus === 'suspended' ? activateUserAction : suspendUserAction
      const result = await action(userId)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending
          ? 'Memproses...'
          : accountStatus === 'suspended'
            ? 'Aktifkan Pengguna'
            : 'Suspend Pengguna'}
      </Button>
    </div>
  )
}
```

Note: this file must be saved as `app/admin/users/[id]/suspend-activate-button.tsx`, sitting alongside `page.tsx` in the same `[id]` folder.

- [ ] **Step 6: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean; route list includes `/admin/users` and `/admin/users/[id]`.

- [ ] **Step 7: Commit**

```bash
git add app/admin/users
git commit -m "feat(admin): add admin user management pages"
```

---

### Task 7: Suspend enforcement in `getCurrentUser()`

**Files:**
- Modify: `lib/auth/get-current-user.ts:1-34`

**Interfaces:**
- Produces: `getCurrentUser()` now returns `null` for a suspended user — every existing caller (`requireRole`, `requireAdminOr404`, and every page's own `if (!user)` check) is unaffected in its own logic and automatically gets full lockout as a result.

- [ ] **Step 1: Add the service-role suspension check**

Replace the full contents of `lib/auth/get-current-user.ts` (lines 1-34, i.e. everything above `requireRole`) with:

```ts
import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hasRole, type AppRole } from './has-role'
import { appError } from '@/lib/errors'

export interface CurrentUser {
  id: string
  email: string | null
  roles: AppRole[]
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) return null

  // account_status has no SELECT grant for the auth-context client at all
  // (supabase/migrations/20260907120918_profiles_column_grant_restriction.sql),
  // so this must go through the service-role client. A suspended user is
  // treated exactly like a logged-out one -- every existing caller already
  // handles a null CurrentUser, so this is full lockout everywhere at once.
  const serviceClient = createServiceClient()
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('account_status')
    .eq('id', claims.sub)
    .maybeSingle()

  if (profileError) {
    throw new Error('Failed to load account status for the current user.')
  }
  if (profile?.account_status === 'suspended') {
    return null
  }

  const { data: roleRows, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', claims.sub)

  if (error) {
    throw new Error('Failed to load roles for the current user.')
  }

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    roles: (roleRows ?? []).map((r) => r.role as AppRole),
  }
})
```

`requireRole`, `requireAdminOr404` below this block are unchanged.

- [ ] **Step 2: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 3: Run the full test suite**

```bash
npm test
```

Expected: all existing tests still pass (this file has no existing unit tests — its behavior is exercised end-to-end in Task 8).

- [ ] **Step 4: Commit**

```bash
git add lib/auth/get-current-user.ts
git commit -m "feat(auth): enforce full lockout for suspended accounts in getCurrentUser"
```

---

### Task 8: Phase 10 Definition-of-Done verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be unchanged from Phase 9's 73 (this phase adds no new Zod schema/tests, per Global Constraints).

- [ ] **Step 2: Create test accounts and a job with a verified payment**

Create 1 employer + 1 worker account (`phase10-employer@example.com`, `phase10-worker@example.com`, password `password1`) via the same `auth.admin.createUser` + `user_roles` pattern used in every prior phase's verification. Drive (or script via direct RPC calls, whichever is faster) a job through: create → open → apply → `select_job_worker` → `get_or_create_payment` → `submit_payment_proof` → `review_payment(decision: 'verified')`, reaching `payments.status = 'verified'` and `jobs.status = 'payment_verified'`.

- [ ] **Step 3: Verify the refund flow against the real DB/RPCs**

Sign in as the admin (an existing admin account from prior phases, or create one), and directly exercise (via a one-off script using the anon key + `signInWithPassword`, or through the actual `/admin/payments/[id]` UI — UI is recommended since it also re-confirms Task 3's page renders correctly):

1. Attempt `cancel_job_and_refund` on a job whose payment is `'waiting_verification'` (not yet verified) — confirm it fails with `CONFLICT: payment not verified`.
2. Call `cancel_job_and_refund` on the Step 2 job with a real reason string — confirm `jobs.status = 'cancelled'`, `jobs.cancelled_reason` matches, `job_assignments.status = 'cancelled'`, `payments.status = 'refund_pending'`, and an `audit_logs` row with action `'JOB_CANCELLED'` exists.
3. Attempt `cancel_job_and_refund` again on the same job — confirm `CONFLICT: payment not verified` (status is no longer `'verified'`).
4. Call `mark_refund_paid` with a proof path outside the payment's own folder (e.g. `some-other-id/file.png`) — confirm `VALIDATION_ERROR: file_path outside payment folder`.
5. Call `mark_refund_paid` with a correctly-scoped path — confirm `payments.status = 'refunded'`, `refund_transfer_proof_path`/`refunded_by`/`refunded_at` are set, and an `audit_logs` row with action `'REFUND_PAID'` exists.
6. Visit `/jobs/[id]` as the employer — confirm the job shows status `cancelled` and the cancellation reason.

- [ ] **Step 4: Verify the Admin Dashboard**

Visit `/admin` as the admin — hand-compute each of the 7 counts via direct queries against the same DB state and confirm they match the page exactly.

- [ ] **Step 5: Verify Admin User Management and suspend enforcement**

1. Visit `/admin/users` as the admin — confirm the Step 2 worker/employer both appear, confirm search (by partial name and by partial email) and the role/status filters each narrow the list correctly.
2. Visit `/admin/users/[id]` for the Step 2 worker, click Suspend — confirm `profiles.account_status = 'suspended'` and an `audit_logs` row `'USER_SUSPENDED'`.
3. Sign in as that now-suspended worker (fresh sign-in, e.g. visit any page requiring auth) — confirm they are treated as logged out (redirected/blocked the same way an unauthenticated visitor would be, not shown a distinct "suspended" message, since no such UI was built this phase).
4. As the admin, activate the same user — confirm `account_status = 'active'` and `audit_logs` `'USER_ACTIVATED'`, and that the user can authenticate normally again.
5. Attempt to suspend the admin's own account (call `suspend_user` with the admin's own id) — confirm `FORBIDDEN: cannot suspend own account` and `account_status` is unchanged.

- [ ] **Step 6: Clean up all test data**

Delete in FK-safe order: `audit_logs` rows created by this verification (optional — audit logs are append-only elsewhere in this app, but these are throwaway test rows) → `payments` → `job_applications`/`job_assignments` → `jobs` → `user_roles` → `profiles` → `auth.users`. Verify zero leftovers afterward.

- [ ] **Step 7: Report results**

Note clearly which of Steps 3-5's checks passed, with what was actually observed (not just "pass") — mirroring every prior phase's verification report format. If any fail, do not mark Phase 10 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 10 Definition of Done

- [ ] Admin can cancel a job whose payment is `'verified'` and not yet `'completed'`, which flips the job to `'cancelled'` (with reason recorded) and the payment to `'refund_pending'` — blocked with `CONFLICT` otherwise.
- [ ] Admin can upload a transfer-proof and mark a `'refund_pending'` payment `'refunded'`, recording who and when.
- [ ] No `wallet_transactions` row is ever written for a job refund.
- [ ] `/admin` shows the 7 dashboard counts, matching hand-verified queries.
- [ ] `/admin/users` lists, searches (name or email), and filters (role, status) every user; `/admin/users/[id]` shows profile/roles/status and an Activate/Suspend action.
- [ ] Suspending a user blocks every subsequent authenticated request from them, enforced through `getCurrentUser()` with no new middleware; activating restores access.
- [ ] An admin cannot suspend their own account.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] Step 3-5's checks in Task 8 were genuinely executed against the real DB/RPCs (and the UI where used), not attested to from code review.
