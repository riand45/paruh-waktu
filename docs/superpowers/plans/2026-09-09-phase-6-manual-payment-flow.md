# Phase 6 — Manual Payment Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employer view bank-transfer payment instructions for an assigned job (created lazily on first view), upload a payment proof (with resubmission allowed after rejection), and let Admin review and approve/reject that proof — all without touching the wallet/ledger, which is a later phase's concern.

**Architecture:** `payments`/`payment_proofs`/the `payment-proofs` storage bucket already exist (Phase 1 migration), with correct SELECT-only RLS on the tables and a working INSERT/SELECT RLS pair on the storage bucket. Three new `SECURITY DEFINER` Postgres functions handle every multi-table write (`get_or_create_payment`, `submit_payment_proof`, `review_payment`), mirroring the exact pattern established by Phase 3's `review_employer_verification` and Phase 5's `select_job_worker` — including the `is distinct from` (not `<>`) ownership-check idiom and an explicit `revoke ... from service_role`, both learned the hard way in Phase 5. Because `payments`' own SELECT RLS is already correct, the service layer's *reads* need no service-role client or manual visibility re-derivation at all — only the three RPC *writes* need the auth-context client (never service-role, since each RPC re-derives `auth.uid()` internally).

**Tech Stack:** Next.js 16.3.4 (Server Actions, `useActionState`, native `<form>`), Zod v4, Supabase (auth-context client throughout — no service-role client needed anywhere in this phase's service layer), Supabase CLI (`npx supabase db push`), Vitest, Playwright (already installed on this machine from Phase 5 — reuse it, don't reinstall).

**Spec:** `docs/superpowers/specs/2026-09-09-manual-payment-flow-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §17-21, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` §15-17/§28 and STEP 7, and Phase 3/5's plans for schema and conventions this phase builds on.

## Global Constraints

- `payments`/`payment_proofs` have SELECT-only RLS and no write policy — every write goes through one of this phase's three `SECURITY DEFINER` functions, never a service-role client, never a plain client-side insert/update.
- **Every one of the three new RPC functions must use `is distinct from` (never `<>`) for its ownership/equality checks against `(select auth.uid())`, and must `revoke execute ... from public, anon, service_role` (not just `public, anon`).** Phase 5 shipped a fail-open auth bug from exactly this mistake (`<>` against a possibly-NULL `auth.uid()` silently skips the FORBIDDEN check); this phase builds the fix in from the start rather than discovering it in review.
- **The three RPCs must be called via the regular auth-context client (`createClient()` from `lib/supabase/server.ts`), never `createServiceClient()`** — each one is `SECURITY DEFINER` and re-derives `auth.uid()` internally to enforce ownership/admin status.
- `get_or_create_payment` is idempotent — if a `payments` row already exists for the job, return its id immediately, before any status check, so it is always safe to call regardless of the job's current stage.
- `submit_payment_proof` allows resubmission after rejection — accepts `payments.status in ('waiting_payment', 'rejected')`, never just `'waiting_payment'` alone. No cap on rejection→resubmit cycles.
- This phase never writes to `wallets` or `wallet_transactions` — wallet funding is tied to job completion (a later phase), not payment verification.
- This phase stops at `jobs.status = 'payment_verified'` on approval — never advances further to `'in_progress'`.
- Reads in the service layer use the auth-context client and rely on `payments`' own correct SELECT RLS — do not reimplement visibility checks in JS for this table (unlike `jobs`, which needed that).
- Avoid PostgREST embedded selects (`.select('*, jobs(title)')`) for joining job/employer names into payment lists — use the two-query-plus-`Map` pattern already established in `lib/services/applications.ts`, to avoid ambiguous generated-type shapes.
- Every Server Action re-verifies authentication/authorization inside itself via the service layer — never rely on `proxy.ts`'s redirect alone.
- The file-upload flow (payment proof) mirrors Phase 3's KTP-upload precedent exactly: a single Server Action receives the file via `FormData`, uploads it server-side via the auth-context client, then calls the RPC to record it — rolling back the uploaded object if the RPC call fails.

---

### Task 1: Validation schema (Zod) for the payment proof form

**Files:**
- Create: `lib/validations/payment.ts`
- Create: `lib/validations/payment.test.ts`

**Interfaces:**
- Produces: `SubmitPaymentProofSchema`, `SubmitPaymentProofInput` (type), `PaymentProofFormState` — consumed by Task 3 (service layer) and Task 4 (Server Action + form).

- [ ] **Step 1: Write the failing tests**

Create `lib/validations/payment.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SubmitPaymentProofSchema } from './payment'

describe('SubmitPaymentProofSchema', () => {
  it('accepts a valid past transfer date', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: yesterday })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.transferDate).toBeInstanceOf(Date)
    }
  })

  it('accepts today as the transfer date', () => {
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: new Date().toISOString() })
    expect(result.success).toBe(true)
  })

  it('rejects a future transfer date', () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: tomorrow })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid date string', () => {
    const result = SubmitPaymentProofSchema.safeParse({ transferDate: 'not-a-date' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/validations/payment.test.ts
```

Expected: FAIL — `Cannot find module './payment'`.

- [ ] **Step 3: Implement the schema**

Create `lib/validations/payment.ts`:

```ts
import { z } from 'zod'

export const SubmitPaymentProofSchema = z.object({
  transferDate: z.coerce
    .date({ error: 'Tanggal transfer tidak valid.' })
    .refine((d) => d.getTime() <= Date.now(), { error: 'Tanggal transfer tidak boleh di masa depan.' }),
})

export type SubmitPaymentProofInput = z.infer<typeof SubmitPaymentProofSchema>

export type PaymentProofFormState =
  | {
      errors?: {
        transferDate?: string[]
        file?: string[]
      }
      message?: string
    }
  | undefined
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/payment.test.ts
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
git commit -m "feat: add Zod validation schema for payment proof submission"
```

---

### Task 2: Database migration — atomic payment functions

**Files:**
- Create: `supabase/migrations/<timestamp>_payment_flow.sql`

**Interfaces:**
- Produces: `public.get_or_create_payment(p_job_id uuid) returns uuid`, `public.submit_payment_proof(p_payment_id uuid, p_file_path text, p_file_size_bytes bigint, p_transfer_date date) returns uuid`, `public.review_payment(p_payment_id uuid, p_decision text, p_rejection_reason text default null) returns void` — consumed by Task 3's service layer.
- Consumes: `public.jobs`, `public.payments`, `public.payment_proofs`, `public.platform_settings`, `public.audit_logs`, `public.is_admin()` (all Phase 1).

- [ ] **Step 1: Re-establish the Supabase CLI link**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

(The CLI should already have a stored login session from Phase 5 — if it prompts for a database password, use the one from the Supabase dashboard.)

- [ ] **Step 2: Verify the link**

```bash
npx supabase migration list
```

Expected: lists every migration through `20260909033909_fix_select_job_worker_auth_check.sql` as applied on both `Local` and `Remote`. **If anything is missing from Remote, stop and investigate before continuing** — do not guess at a repair without understanding why (Phase 5 hit exactly this and it turned out to be an unrelated pre-existing bookkeeping gap, not something to blindly re-apply).

- [ ] **Step 3: Create the migration file**

```bash
npx supabase migration new payment_flow
```

Note the generated filename (e.g. `supabase/migrations/20260909120000_payment_flow.sql`) — edit that exact file in the next step.

- [ ] **Step 4: Write the migration**

Replace the file's contents with:

```sql
-- Seed the Admin's bank-transfer destination as a platform setting. No
-- settings-editor UI exists yet for this or the pre-existing fee settings
-- (platform_fee_percentage/platform_fee_payer) — an Admin must update this
-- value via direct DB access until a future phase builds that UI.
insert into public.platform_settings (key, value) values
  ('admin_bank_account', '{"bank_name": "Bank Central Asia", "account_number": "1234567890", "account_holder_name": "PARUH WAKTU ADMIN"}')
on conflict (key) do nothing;

-- Atomically create a job's payment record on the employer's first view of
-- an assigned job, and transition the job to waiting_payment. Idempotent:
-- returns the existing payment id if one already exists, regardless of the
-- job's current status, so it is always safe to call on every view.
create or replace function public.get_or_create_payment(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_job_status text;
  v_payment_amount numeric;
  v_payment_id uuid;
  v_fee_percentage numeric;
  v_fee_payer text;
  v_platform_fee numeric;
  v_total_amount numeric;
begin
  select employer_id, status, payment_amount into v_employer_id, v_job_status, v_payment_amount
  from public.jobs
  where id = p_job_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  select id into v_payment_id from public.payments where job_id = p_job_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  if v_job_status <> 'assigned' then
    raise exception 'CONFLICT: job not assigned';
  end if;

  select (value #>> '{}')::numeric into v_fee_percentage
  from public.platform_settings where key = 'platform_fee_percentage';
  if v_fee_percentage is null then
    v_fee_percentage := 10;
  end if;

  select value #>> '{}' into v_fee_payer
  from public.platform_settings where key = 'platform_fee_payer';
  if v_fee_payer is null then
    v_fee_payer := 'employer';
  end if;

  v_platform_fee := round(v_payment_amount * v_fee_percentage / 100, 2);
  v_total_amount := case
    when v_fee_payer = 'employer' then v_payment_amount + v_platform_fee
    else v_payment_amount
  end;

  insert into public.payments (job_id, employer_id, amount, platform_fee, total_amount, fee_payer, status)
  values (p_job_id, v_employer_id, v_payment_amount, v_platform_fee, v_total_amount, v_fee_payer, 'waiting_payment')
  returning id into v_payment_id;

  update public.jobs set status = 'waiting_payment' where id = p_job_id;

  return v_payment_id;
end;
$$;

revoke execute on function public.get_or_create_payment from public, anon, service_role;
grant execute on function public.get_or_create_payment to authenticated;

-- Atomically record a payment proof upload, set the transfer date, and
-- transition the payment/job into the admin-review state. Allows
-- resubmission after a rejection (status can be 'waiting_payment' on first
-- submission or 'rejected' on a resubmission) — no cap on retries.
create or replace function public.submit_payment_proof(
  p_payment_id uuid,
  p_file_path text,
  p_file_size_bytes bigint,
  p_transfer_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_status text;
  v_job_id uuid;
  v_proof_id uuid;
begin
  select employer_id, status, job_id into v_employer_id, v_status, v_job_id
  from public.payments
  where id = p_payment_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: payment';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status not in ('waiting_payment', 'rejected') then
    raise exception 'CONFLICT: payment not awaiting proof';
  end if;

  insert into public.payment_proofs (payment_id, uploaded_by, file_path, file_size_bytes)
  values (p_payment_id, (select auth.uid()), p_file_path, p_file_size_bytes)
  returning id into v_proof_id;

  update public.payments
  set status = 'waiting_verification',
      transfer_date = p_transfer_date,
      rejection_reason = null
  where id = p_payment_id;

  update public.jobs
  set status = 'payment_review'
  where id = v_job_id;

  return v_proof_id;
end;
$$;

revoke execute on function public.submit_payment_proof from public, anon, service_role;
grant execute on function public.submit_payment_proof to authenticated;

-- Atomically record Admin's payment-verification decision. Mirrors
-- review_employer_verification's exact shape (Phase 3).
create or replace function public.review_payment(
  p_payment_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_decision not in ('verified', 'rejected') then
    raise exception 'VALIDATION_ERROR: invalid decision %', p_decision;
  end if;

  if p_decision = 'rejected'
     and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'VALIDATION_ERROR: rejection_reason required';
  end if;

  select job_id, status into v_job_id, v_status
  from public.payments
  where id = p_payment_id
  for update;

  if v_job_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'waiting_verification' then
    raise exception 'CONFLICT: already reviewed';
  end if;

  update public.payments
  set status = p_decision,
      verified_at = now(),
      verified_by = (select auth.uid()),
      rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else null end
  where id = p_payment_id;

  update public.jobs
  set status = case when p_decision = 'verified' then 'payment_verified' else 'payment_rejected' end
  where id = v_job_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values (
    (select auth.uid()),
    case when p_decision = 'verified' then 'PAYMENT_VERIFIED' else 'PAYMENT_REJECTED' end,
    'payment',
    p_payment_id,
    case when p_decision = 'rejected' then p_rejection_reason else null end
  );
end;
$$;

revoke execute on function public.review_payment from public, anon, service_role;
grant execute on function public.review_payment to authenticated;
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

Expected: the new `payment_flow` migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 7: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: the file updates — diff should show `get_or_create_payment`, `submit_payment_proof`, `review_payment` appear under the `public` schema's `Functions` block, alongside the existing `is_admin`/`review_employer_verification`/`select_job_worker` entries. `platform_settings` gains no new columns (only a new row, not visible in the generated types).

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Task 3).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add payment flow atomic functions and admin bank account setting"
```

---

### Task 3: Payments service layer

**Files:**
- Create: `lib/services/payments.ts`

**Interfaces:**
- Produces: `PaymentDetail`, `PendingPaymentSummary`, `AdminPaymentDetail` (interfaces); `getPaymentForJob(jobId)`, `submitPaymentProof(paymentId, file, transferDate)`, `getPendingPayments()`, `getPaymentDetailForAdmin(paymentId)`, `reviewPayment(paymentId, decision, rejectionReason?)` — consumed by Task 4 (employer payment page + action) and Task 5 (admin payments pages + action).
- Consumes: `getCurrentUser`, `requireRole` (Phase 1's `lib/auth/get-current-user.ts`), `createClient` (Phase 1's `lib/supabase/server.ts`), `appError` (Phase 1's `lib/errors.ts`).

- [ ] **Step 1: Write the service layer**

Create `lib/services/payments.ts`:

```ts
import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import { SubmitPaymentProofSchema } from '@/lib/validations/payment'

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
  }
}

export async function getPaymentForJob(jobId: string): Promise<PaymentDetail | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const supabase = await createClient()

  const { data: job } = await supabase.from('jobs').select('employer_id').eq('id', jobId).maybeSingle()

  if (job && job.employer_id === user.id) {
    const { error } = await supabase.rpc('get_or_create_payment', { p_job_id: jobId })
    if (error) {
      throw appError('INTERNAL_ERROR')
    }
  }

  const { data, error } = await supabase
    .from('payments')
    .select('id, job_id, amount, platform_fee, total_amount, fee_payer, status, transfer_date, rejection_reason')
    .eq('job_id', jobId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return mapPaymentRow(data)
}

function mapSubmitProofError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pembayaran ini sudah tidak menerima bukti transfer baru.')
  }
  return appError('INTERNAL_ERROR')
}

export async function submitPaymentProof(
  paymentId: string,
  file: File,
  transferDate: Date
): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }
  const validated = SubmitPaymentProofSchema.parse({ transferDate })

  const supabase = await createClient()
  const path = `${paymentId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('payment-proofs')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti transfer.')
  }

  const { data, error } = await supabase.rpc('submit_payment_proof', {
    p_payment_id: paymentId,
    p_file_path: path,
    p_file_size_bytes: file.size,
    p_transfer_date: validated.transferDate.toISOString().slice(0, 10),
  })

  if (error) {
    await supabase.storage.from('payment-proofs').remove([path])
    throw mapSubmitProofError(error.message)
  }

  return { id: data as string }
}

export interface PendingPaymentSummary {
  id: string
  jobId: string
  jobTitle: string
  employerName: string
  totalAmount: number
  status: string
}

export async function getPendingPayments(): Promise<PendingPaymentSummary[]> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: payments, error } = await supabase
    .from('payments')
    .select('id, job_id, employer_id, total_amount, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = payments ?? []
  const statusOrder: Record<string, number> = {
    waiting_verification: 0,
    waiting_payment: 1,
    rejected: 2,
    verified: 3,
  }
  rows.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4))

  if (rows.length === 0) {
    return []
  }

  const jobIds = rows.map((row) => row.job_id)
  const employerIds = rows.map((row) => row.employer_id)

  const { data: jobs } = await supabase.from('jobs').select('id, title').in('id', jobIds)
  const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', employerIds)

  const titleById = new Map((jobs ?? []).map((job) => [job.id, job.title]))
  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    jobTitle: titleById.get(row.job_id) ?? 'Pekerjaan tidak diketahui',
    employerName: nameById.get(row.employer_id) ?? 'Tidak diketahui',
    totalAmount: row.total_amount,
    status: row.status,
  }))
}

export interface AdminPaymentDetail extends PaymentDetail {
  jobTitle: string
  employerName: string
  proofs: { id: string; filePath: string; uploadedAt: string }[]
}

export async function getPaymentDetailForAdmin(paymentId: string): Promise<AdminPaymentDetail | null> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: payment, error } = await supabase
    .from('payments')
    .select(
      'id, job_id, employer_id, amount, platform_fee, total_amount, fee_payer, status, transfer_date, rejection_reason'
    )
    .eq('id', paymentId)
    .maybeSingle()

  if (error || !payment) {
    return null
  }

  const { data: job } = await supabase.from('jobs').select('title').eq('id', payment.job_id).maybeSingle()
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', payment.employer_id)
    .maybeSingle()

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
    employerName: profile?.full_name ?? 'Tidak diketahui',
    proofs: (proofs ?? []).map((proof) => ({
      id: proof.id,
      filePath: proof.file_path,
      uploadedAt: proof.created_at,
    })),
  }
}

function mapReviewPaymentError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pembayaran ini sudah ditinjau sebelumnya.')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('rejection_reason required')) {
    return appError('VALIDATION_ERROR', 'Alasan penolakan wajib diisi.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function reviewPayment(
  paymentId: string,
  decision: 'verified' | 'rejected',
  rejectionReason?: string
): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('review_payment', {
    p_payment_id: paymentId,
    p_decision: decision,
    p_rejection_reason: rejectionReason,
  })

  if (error) {
    throw mapReviewPaymentError(error.message)
  }
}
```

Note: every function uses `createClient()` (the auth-context client) — this file never imports `createServiceClient`. Reads rely on `payments`' own correct SELECT RLS; writes go through the three RPCs, which re-derive `auth.uid()`/`is_admin()` themselves.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. This also confirms Task 2's regenerated types (with the three new functions present) are being picked up correctly.

- [ ] **Step 3: Commit**

```bash
git add lib/services/payments.ts
git commit -m "feat(payments): add payments service layer"
```

---

### Task 4: Employer-facing payment page

**Files:**
- Create: `app/jobs/[id]/payment/page.tsx`
- Create: `app/jobs/[id]/payment/actions.ts`
- Create: `app/jobs/[id]/payment/payment-proof-form.tsx`
- Modify: `app/jobs/[id]/page.tsx` (add one link — see Step 4)

**Interfaces:**
- Consumes: `getPaymentForJob`, `submitPaymentProof` (Task 3); `SubmitPaymentProofSchema`, `PaymentProofFormState` (Task 1); `getJobDetail` (Phase 4); `getCurrentUser` (Phase 1); `createClient` (Phase 1, for reading the `admin_bank_account` setting).

- [ ] **Step 1: Create the Server Action**

Create `app/jobs/[id]/payment/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { submitPaymentProof } from '@/lib/services/payments'
import { SubmitPaymentProofSchema, type PaymentProofFormState } from '@/lib/validations/payment'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export async function submitPaymentProofAction(
  paymentId: string,
  jobId: string,
  _prevState: PaymentProofFormState,
  formData: FormData
): Promise<PaymentProofFormState> {
  const validatedFields = SubmitPaymentProofSchema.safeParse({
    transferDate: formData.get('transferDate'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

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
    await submitPaymentProof(paymentId, file, validatedFields.data.transferDate)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/payment`)
  revalidatePath(`/jobs/${jobId}`)
  return undefined
}
```

- [ ] **Step 2: Create the payment proof form (client component)**

Create `app/jobs/[id]/payment/payment-proof-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { submitPaymentProofAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PaymentProofForm({ paymentId, jobId }: { paymentId: string; jobId: string }) {
  const boundAction = submitPaymentProofAction.bind(null, paymentId, jobId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="transferDate">Tanggal Transfer</Label>
        <Input id="transferDate" name="transferDate" type="date" required />
        {state?.errors?.transferDate && (
          <p className="text-sm text-destructive">{state.errors.transferDate[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Transfer</Label>
        <Input id="file" name="file" type="file" accept="image/jpeg,image/png,application/pdf" required />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Kirim Bukti Transfer'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the payment page**

Create `app/jobs/[id]/payment/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getJobDetail } from '@/lib/services/jobs'
import { getPaymentForJob } from '@/lib/services/payments'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { PaymentProofForm } from './payment-proof-form'

interface AdminBankAccount {
  bank_name: string
  account_number: string
  account_holder_name: string
}

export default async function JobPaymentPage({
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

  const payment = await getPaymentForJob(id)
  if (!payment) {
    notFound()
  }

  const supabase = await createClient()
  const { data: bankSetting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'admin_bank_account')
    .maybeSingle()

  const bankAccount = bankSetting?.value as AdminBankAccount | undefined

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pembayaran: {job.title}</h1>
      {bankAccount && (
        <dl className="flex flex-col gap-2 rounded border p-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Bank</dt>
            <dd>{bankAccount.bank_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Nomor Rekening</dt>
            <dd>{bankAccount.account_number}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Atas Nama</dt>
            <dd>{bankAccount.account_holder_name}</dd>
          </div>
        </dl>
      )}
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Total yang Harus Ditransfer</dt>
          <dd className="text-lg font-semibold">Rp{payment.totalAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status Pembayaran</dt>
          <dd>{payment.status}</dd>
        </div>
      </dl>
      {payment.status === 'rejected' && payment.rejectionReason && (
        <p className="text-sm text-destructive">Alasan penolakan: {payment.rejectionReason}</p>
      )}
      {(payment.status === 'waiting_payment' || payment.status === 'rejected') && (
        <PaymentProofForm paymentId={payment.id} jobId={id} />
      )}
      {payment.status === 'waiting_verification' && (
        <p className="text-sm text-muted-foreground">Menunggu verifikasi Admin.</p>
      )}
      {payment.status === 'verified' && (
        <p className="text-sm text-green-600">Pembayaran telah diverifikasi.</p>
      )}
    </div>
  )
}
```

Note: `getPaymentForJob` (Task 3) already calls `get_or_create_payment` internally when the caller is the job's employer — this page never calls that RPC directly. If `job.status` is still `'assigned'` when this page is first visited, `payment` starts out `null` from the DB's perspective until `getPaymentForJob`'s internal RPC call creates it; by the time this page reads `getPaymentForJob`'s return value, the row already exists (the function is synchronous from the caller's perspective, awaited before the read), so the `if (!payment) { notFound() }` guard only fires for a genuine error case (e.g. the job isn't actually `assigned` or later, which `job.employerId !== user.id` above would already have caught for a non-owner, or the RPC's own `CONFLICT: job not assigned` surfacing as a thrown `appError` from `getPaymentForJob` — in which case this page will show Next's default error boundary, consistent with how every other uncaught `AppError` in this app behaves today).

- [ ] **Step 4: Link to the payment page from the job detail page**

Read `app/jobs/[id]/page.tsx` first to confirm its current exact content (Phase 5 added a "Lihat Pelamar" link; this task does not touch that block). It currently has:

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

Add this immediately after it:

```tsx
      {isOwner &&
        ['assigned', 'waiting_payment', 'payment_review', 'payment_verified', 'payment_rejected'].includes(
          job.status
        ) && (
          <Link
            href={`/jobs/${job.id}/payment`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Lihat Pembayaran
          </Link>
        )}
```

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add app/jobs
git commit -m "feat(payments): add employer payment instructions and proof upload page"
```

---

### Task 5: Admin-facing payment review

**Files:**
- Create: `app/admin/payments/page.tsx`
- Create: `app/admin/payments/[id]/page.tsx`
- Create: `app/admin/payments/[id]/review-form.tsx`
- Create: `app/admin/payments/actions.ts`

**Interfaces:**
- Consumes: `getPendingPayments`, `getPaymentDetailForAdmin`, `reviewPayment` (Task 3); `requireAdminOr404` (Phase 3's `lib/auth/get-current-user.ts`); `createClient` (Phase 1, for signed proof URLs).

Before writing these, read `app/admin/employer-verifications/page.tsx`, `[id]/page.tsx`, `[id]/review-form.tsx`, and `actions.ts` in full (Phase 3) — this task mirrors their route structure and conventions closely, adapted for `payments` instead of `employer_verifications`.

- [ ] **Step 1: Create the Server Action**

Create `app/admin/payments/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { reviewPayment } from '@/lib/services/payments'
import { toSafeErrorMessage } from '@/lib/errors'

export async function reviewPaymentAction(
  paymentId: string,
  decision: 'verified' | 'rejected',
  rejectionReason?: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await reviewPayment(paymentId, decision, rejectionReason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${paymentId}`)
  return { success: true }
}
```

Note: unlike Phase 3's `reviewEmployerVerificationAction`, this action does not call `requireRole('admin')` itself — `reviewPayment` (Task 3) already does, so re-checking here would be redundant. This matches the convention already established in Phase 5's `applyToJobAction`/etc. (auth check lives once, in the service layer).

- [ ] **Step 2: Create the review form (client component)**

Create `app/admin/payments/[id]/review-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewPaymentAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ReviewForm({ paymentId }: { paymentId: string }) {
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleDecision(decision: 'verified' | 'rejected') {
    setError(null)
    if (decision === 'rejected' && rejectionReason.trim().length === 0) {
      setError('Alasan penolakan wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = await reviewPaymentAction(
        paymentId,
        decision,
        decision === 'rejected' ? rejectionReason : undefined
      )
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/payments')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rejectionReason">Alasan Penolakan (jika ditolak)</Label>
        <Input
          id="rejectionReason"
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={isPending} onClick={() => handleDecision('verified')}>
          {isPending ? 'Memproses...' : 'Setujui'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => handleDecision('rejected')}
        >
          {isPending ? 'Memproses...' : 'Tolak'}
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create the payments list page**

Create `app/admin/payments/page.tsx`:

```tsx
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getPendingPayments } from '@/lib/services/payments'

export default async function AdminPaymentsPage() {
  await requireAdminOr404()
  const payments = await getPendingPayments()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pembayaran</h1>
      {payments.length === 0 && <p className="text-sm text-muted-foreground">Belum ada pembayaran.</p>}
      <ul className="flex flex-col gap-2">
        {payments.map((payment) => (
          <li key={payment.id}>
            <Link
              href={`/admin/payments/${payment.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{payment.jobTitle}</span>
                <span className="text-muted-foreground">{payment.employerName}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span>Rp{payment.totalAmount.toLocaleString('id-ID')}</span>
                <span className="text-muted-foreground">{payment.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Create the payment detail page**

Create `app/admin/payments/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getPaymentDetailForAdmin } from '@/lib/services/payments'
import { createClient } from '@/lib/supabase/server'
import { ReviewForm } from './review-form'

export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const payment = await getPaymentDetailForAdmin(id)
  if (!payment) {
    notFound()
  }

  const supabase = await createClient()
  const proofsWithUrls = await Promise.all(
    payment.proofs.map(async (proof) => {
      const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(proof.filePath, 60)
      return { ...proof, signedUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pembayaran: {payment.jobTitle}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Employer</dt>
          <dd>{payment.employerName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nominal Pekerjaan</dt>
          <dd>Rp{payment.amount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Platform Fee</dt>
          <dd>Rp{payment.platformFee.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total Transfer</dt>
          <dd>Rp{payment.totalAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tanggal Transfer</dt>
          <dd>{payment.transferDate ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{payment.status}</dd>
        </div>
        {payment.rejectionReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Penolakan Sebelumnya</dt>
            <dd>{payment.rejectionReason}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Bukti Transfer</span>
        {proofsWithUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada bukti transfer.</p>
        )}
        {proofsWithUrls.map((proof) => {
          const isImage = /\.(jpg|jpeg|png)$/i.test(proof.filePath)
          return (
            <div key={proof.id} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Diunggah {new Date(proof.uploadedAt).toLocaleString('id-ID')}
              </span>
              {!proof.signedUrl && <p className="text-sm text-destructive">Gagal memuat bukti transfer.</p>}
              {proof.signedUrl && isImage && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
                <img src={proof.signedUrl} alt="Bukti transfer" className="max-w-full rounded border" />
              )}
              {proof.signedUrl && !isImage && (
                <a
                  href={proof.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Lihat Bukti Transfer (PDF)
                </a>
              )}
            </div>
          )
        })}
      </div>
      {payment.status === 'waiting_verification' && <ReviewForm paymentId={payment.id} />}
    </div>
  )
}
```

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add app/admin/payments
git commit -m "feat(payments): add admin payment review pages"
```

---

### Task 6: Phase 6 Definition-of-Done verification

**Files:** none (verification only).

**This task must be genuinely executed with a real running app and a real browser (Playwright), not attested to from code review alone.** Phase 5's own final verification skipped this once, and browser testing subsequently found a real regression that every code review had missed — do not repeat that mistake. Playwright + Chromium are already installed on this machine from Phase 5 (cached at `~/Library/Caches/ms-playwright/`) — do not reinstall; if `require('playwright')` doesn't resolve directly from this worktree's `node_modules`, set `NODE_PATH` to the npx cache directory the way Phase 5's verification did (find it via `find ~/.npm/_npx -maxdepth 2 -name playwright -type d 2>/dev/null` if unsure).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be the current total (55 as of Phase 5's merge) + Task 1's 4 = 59.

- [ ] **Step 2: Create three throwaway test accounts and a pre-assigned job**

Create 1 employer + 1 worker via the same `auth.admin.createUser` + `user_roles` pattern used in Phase 4/5's verification (see those plans for the exact script shape) — email `phase6-employer@example.com` / `phase6-worker@example.com`, password `password1`. Then, as the employer, create a job and get it to `status = 'assigned'` with the worker as `assigned_worker_id` — either by driving the full apply→select flow through the actual UI (recommended, since it also re-confirms Phases 4-5 still work end-to-end), or by directly inserting a `job_applications` row (`status = 'pending'`) and calling `select_job_worker` via a one-off script if faster. Also create a second worker account (`phase6-worker-b@example.com`) if you want to test the "Admin rejects, employer resubmits" path with a clean second attempt — not strictly required, one worker suffices for every check below.

- [ ] **Step 3: Verify the full flow in a real browser**

Start the dev server, wait for it to actually respond (poll, don't sleep-guess), then drive through:

1. Log in as the employer, visit `/jobs/[id]` for the now-`assigned` job — confirm a "Lihat Pembayaran" link appears.
2. Click it, land on `/jobs/[id]/payment` — confirm it shows the Admin's bank account details, the total amount to transfer (job's `payment_amount` + 10% fee, since `fee_payer` seed value is `'employer'`), and an upload form. Reload the page once — confirm no duplicate payment row is created (still shows the same amount) and `jobs.status` is now `waiting_payment` (check directly against the DB, or via `/jobs/[id]`'s status display).
3. Submit the form with a valid past transfer date and a JPEG/PNG/PDF file — confirm it succeeds, the page now shows "Menunggu verifikasi Admin", and `jobs.status` is now `payment_review`.
4. Log in as Admin, visit `/admin/payments` — confirm the new payment appears, showing the employer's name, job title, and total amount.
5. Click into it, confirm the uploaded proof renders (image inline, or a working signed-URL link for a PDF), and the amount breakdown (job amount / platform fee / total) is correct.
6. Click "Tolak" without entering a reason — confirm a client-side validation error appears and nothing is submitted. Enter a reason and click "Tolak" again — confirm it succeeds, redirects to the list, and the payment shows `rejected`.
7. Log in as the employer, revisit `/jobs/[id]/payment` — confirm the rejection reason is shown and the upload form reappears (resubmission allowed).
8. Submit a new proof — confirm it succeeds and the payment returns to `waiting_verification`, with the rejection reason cleared.
9. Log in as Admin, revisit the same payment (should now show BOTH proof uploads, newest first) — click "Setujui" — confirm it succeeds, and the payment now shows `verified`.
10. Log in as the employer, revisit `/jobs/[id]/payment` — confirm it shows the "Pembayaran telah diverifikasi" success state, and `/jobs/[id]` shows `jobs.status = payment_verified` (not `in_progress` — confirm this phase's own scope boundary holds).
11. Log in as the assigned worker, visit `/jobs/[id]` — confirm they can see the job's `status` field reflecting the current payment stage (no dedicated payment page exists for workers by design — just confirm they aren't blocked from viewing the job itself, matching Phase 5's visibility-fix logic which already grants them access as the assigned worker).
12. As a different, uninvolved authenticated account (a plain worker with no application on this job), attempt to visit `/jobs/[id]/payment` directly — confirm `notFound()` (404), not an error page or the payment details.
13. As a plain (non-admin) authenticated account, attempt to visit `/admin/payments` directly — confirm `notFound()` (404), matching `requireAdminOr404`'s established behavior.

- [ ] **Step 4: Clean up the test accounts, job, and payment**

Delete in FK-safe order (payment_proofs → payments → job_applications/job_assignments → jobs → user_roles → profiles → auth users), matching the manual cleanup order Phase 5's verification had to use once it discovered the `NO ACTION` FK constraints (`supabase/migrations/20260907120526_tighten_delete_constraints.sql`) make the naive delete-everything-in-any-order approach fail. Verify zero leftovers afterward. Stop the dev server cleanly (kill the exact PID on the port, not a broad `pkill`).

- [ ] **Step 5: Report results**

Note clearly which of Step 3's 13 checks passed, with what was actually observed (not just "pass") — mirroring Phase 5's verification report format. If any fail, do not mark Phase 6 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 6 Definition of Done

- [ ] An employer viewing their newly-assigned job sees a "Lihat Pembayaran" link, and visiting it lazily creates the payment record (idempotently — no duplicates on repeated views) and transitions the job to `waiting_payment`.
- [ ] The payment page shows the Admin's bank account details and the correct total amount (job price + 10% fee, since `fee_payer` defaults to `'employer'`).
- [ ] The employer can upload a payment proof (transfer date + file); this transitions the payment to `waiting_verification` and the job to `payment_review`.
- [ ] Admin can see all payments (pending-first) at `/admin/payments`, view the proof and amount breakdown, and approve or reject with a required reason on rejection.
- [ ] Rejecting a payment lets the employer see the reason and resubmit a new proof, with no cap on retries; the review history (multiple proof uploads) remains visible to Admin.
- [ ] Approving a payment sets `jobs.status = 'payment_verified'` and stops there — no automatic advance to `in_progress`.
- [ ] A non-owner cannot view `/jobs/[id]/payment`; a non-admin cannot view `/admin/payments` — both `notFound()`, not an error page.
- [ ] No code in this phase writes to `wallets` or `wallet_transactions`.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] Step 3's full 13-check browser walkthrough was genuinely executed via Playwright, not attested to from code review.
