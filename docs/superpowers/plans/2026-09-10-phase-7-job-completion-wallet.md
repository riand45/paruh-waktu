# Phase 7 — Job Completion & Wallet Crediting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the assigned worker upload work evidence and submit a completion request for an in-progress job, and let the employer confirm it — atomically crediting the worker's wallet from the job's already-verified payment and marking the job completed — plus a minimal wallet-balance view for the worker.

**Architecture:** `job_evidences`/`wallets`/`wallet_transactions` already exist (Phase 1 migration), with correct SELECT-only RLS on all three tables and a working INSERT/SELECT RLS pair on the `job-evidences` storage bucket. Four new `SECURITY DEFINER` Postgres functions handle every multi-table write (`start_work`, `record_job_evidence`, `submit_job_completion`, `confirm_job_completion`), mirroring the exact pattern established by Phase 6's payment functions — including the `is distinct from` (not `<>`) ownership-check idiom and an explicit `revoke ... from service_role`. `confirm_job_completion` reads the job's already-verified `payments` row for its locked-in `amount`/`platform_fee`/`fee_payer` rather than re-deriving from live `platform_settings`, and lazily creates the worker's `wallets` row exactly like Phase 6's `get_or_create_payment` lazily created the payment row.

**Tech Stack:** Next.js 16.3.4 (Server Actions, `useActionState`, `useTransition`, native `<form>`), Supabase (auth-context client throughout — no service-role client needed anywhere in this phase's service layer), Supabase CLI (`npx supabase db push`), Vitest, Playwright (already installed on this machine — reuse it, don't reinstall).

**Spec:** `docs/superpowers/specs/2026-09-10-job-completion-wallet-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §19-20/§22-26, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` §19-20 and STEP 8, and Phase 6's plan for schema and conventions this phase builds on.

## Global Constraints

- `job_evidences`/`wallets`/`wallet_transactions` have SELECT-only RLS and no write policy — every write goes through one of this phase's four `SECURITY DEFINER` functions, never a service-role client, never a plain client-side insert/update.
- **Every one of the four new RPC functions must use `is distinct from` (never `<>`) for its ownership/equality checks against `(select auth.uid())`, and must `revoke execute ... from public, anon, service_role` (not just `public, anon`).** This is the fix Phase 6's final review had to add after the fact for a nullable-comparison auth bug — build it in from the start.
- **The four RPCs must be called via the regular auth-context client (`createClient()` from `lib/supabase/server.ts`), never `createServiceClient()`** — each one is `SECURITY DEFINER` and re-derives `auth.uid()`/ownership internally.
- `start_work` is idempotent — returns successfully (no-op) once `jobs.status` is already `in_progress` or later; only raises `CONFLICT` for a status earlier than `payment_verified`.
- `submit_job_completion` requires at least one `job_evidences` row to already exist for the job — `VALIDATION_ERROR` otherwise.
- `confirm_job_completion` is one atomic transaction: validates the job's `payments` row has `status = 'verified'`, lazily creates the worker's `wallets` row if needed, inserts `wallet_transactions` row(s) using the payment's locked-in `amount`/`platform_fee`/`fee_payer` (never live `platform_settings`), updates `wallets.balance`, sets `job_assignments.status = 'completed'` and `jobs.status = 'completed'`, and writes one `audit_logs` row.
- This phase never writes to `withdrawals` — that's a later phase.
- No reject/rework path on a completion request — `confirm_job_completion` is the only action available to the employer; there is no reject/decline RPC in this phase.
- Reads in the service layer use the auth-context client and rely on `job_evidences`/`wallets`/`wallet_transactions`' own correct SELECT RLS — do not reimplement visibility checks in JS for these tables.
- Every Server Action re-verifies authentication/authorization inside itself via the service layer — never rely on `proxy.ts`'s redirect alone.
- The evidence-upload flow mirrors Phase 6's payment-proof-upload precedent exactly: a single Server Action receives the file via `FormData`, uploads it server-side via the auth-context client, then calls the RPC to record it — attempting to roll back the uploaded object if the RPC call fails (this rollback is a known, already-accepted no-op today, since no DELETE storage policy exists on this bucket either — same already-parked limitation as Phase 6's `payment-proofs` upload, not fixed here).

---

### Task 1: Database migration — atomic job-completion functions

**Files:**
- Create: `supabase/migrations/<timestamp>_job_completion_flow.sql`

**Interfaces:**
- Produces: `public.start_work(p_job_id uuid) returns void`, `public.record_job_evidence(p_job_id uuid, p_file_path text, p_file_type text, p_file_size_bytes bigint) returns uuid`, `public.submit_job_completion(p_job_id uuid) returns void`, `public.confirm_job_completion(p_job_id uuid) returns void` — consumed by Task 2's service layer.
- Consumes: `public.jobs`, `public.job_assignments`, `public.job_evidences`, `public.payments`, `public.wallets`, `public.wallet_transactions`, `public.audit_logs` (all Phase 1/6).

- [ ] **Step 1: Re-establish the Supabase CLI link**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

(The CLI should already have a stored login session from Phase 6 — if it prompts for a database password, use the one from the Supabase dashboard.)

- [ ] **Step 2: Verify the link**

```bash
npx supabase migration list
```

Expected: lists every migration through `20260909105042_fix_payment_flow_composition_issues.sql` as applied on both `Local` and `Remote`. **If anything is missing from Remote, stop and investigate before continuing.**

- [ ] **Step 3: Create the migration file**

```bash
npx supabase migration new job_completion_flow
```

Note the generated filename (e.g. `supabase/migrations/20260910120000_job_completion_flow.sql`) — edit that exact file in the next step.

- [ ] **Step 4: Write the migration**

Replace the file's contents with:

```sql
-- Idempotent lazy transition, triggered by the assigned worker's first
-- view of the job-completion page: payment_verified -> in_progress. Safe
-- to call on every view (a no-op once already in_progress or later),
-- mirroring get_or_create_payment's precedent from Phase 6.
create or replace function public.start_work(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_worker_id uuid;
  v_status text;
begin
  select assigned_worker_id, status into v_assigned_worker_id, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_assigned_worker_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status in ('in_progress', 'waiting_confirmation', 'completed') then
    return;
  end if;

  if v_status <> 'payment_verified' then
    raise exception 'CONFLICT: job not ready to start';
  end if;

  update public.jobs set status = 'in_progress' where id = p_job_id;
end;
$$;

revoke execute on function public.start_work from public, anon, service_role;
grant execute on function public.start_work to authenticated;

-- Atomically record a work-evidence upload. No rework/reject path exists
-- once completion is submitted, so this only accepts uploads while the
-- job is in_progress.
create or replace function public.record_job_evidence(
  p_job_id uuid,
  p_file_path text,
  p_file_type text,
  p_file_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_worker_id uuid;
  v_status text;
  v_assignment_id uuid;
  v_evidence_id uuid;
begin
  select assigned_worker_id, status into v_assigned_worker_id, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_assigned_worker_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'in_progress' then
    raise exception 'CONFLICT: job not in progress';
  end if;

  if p_file_path not like p_job_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside job folder';
  end if;

  select id into v_assignment_id
  from public.job_assignments
  where job_id = p_job_id and status = 'active';

  if v_assignment_id is null then
    raise exception 'NOT_FOUND: active assignment';
  end if;

  insert into public.job_evidences (job_id, assignment_id, uploaded_by, file_path, file_type, file_size_bytes)
  values (p_job_id, v_assignment_id, (select auth.uid()), p_file_path, p_file_type, p_file_size_bytes)
  returning id into v_evidence_id;

  return v_evidence_id;
end;
$$;

revoke execute on function public.record_job_evidence from public, anon, service_role;
grant execute on function public.record_job_evidence to authenticated;

-- Worker submits the completion request: requires at least one evidence
-- file to already exist. No cap on evidence count, no rework path after
-- this point.
create or replace function public.submit_job_completion(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_worker_id uuid;
  v_status text;
  v_evidence_count int;
begin
  select assigned_worker_id, status into v_assigned_worker_id, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_assigned_worker_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'in_progress' then
    raise exception 'CONFLICT: job not in progress';
  end if;

  select count(*) into v_evidence_count
  from public.job_evidences
  where job_id = p_job_id;

  if v_evidence_count = 0 then
    raise exception 'VALIDATION_ERROR: at least one evidence file required';
  end if;

  update public.jobs set status = 'waiting_confirmation' where id = p_job_id;
end;
$$;

revoke execute on function public.submit_job_completion from public, anon, service_role;
grant execute on function public.submit_job_completion to authenticated;

-- Employer confirms completion: one atomic transaction that reads the
-- job's already-verified payment for its locked-in amount/fee/fee_payer
-- (never live platform_settings, which could have changed since the
-- payment was verified), lazily creates the worker's wallet if needed,
-- credits it, marks the assignment and job completed, and writes an
-- audit log entry. No reject/rework path exists for this action.
create or replace function public.confirm_job_completion(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_status text;
  v_assigned_worker_id uuid;
  v_payment_status text;
  v_amount numeric;
  v_platform_fee numeric;
  v_fee_payer text;
  v_wallet_id uuid;
  v_balance numeric;
begin
  select employer_id, status, assigned_worker_id
  into v_employer_id, v_status, v_assigned_worker_id
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'waiting_confirmation' then
    raise exception 'CONFLICT: job not waiting for confirmation';
  end if;

  select status, amount, platform_fee, fee_payer
  into v_payment_status, v_amount, v_platform_fee, v_fee_payer
  from public.payments
  where job_id = p_job_id;

  if v_payment_status is distinct from 'verified' then
    raise exception 'CONFLICT: payment not verified';
  end if;

  insert into public.wallets (user_id)
  values (v_assigned_worker_id)
  on conflict (user_id) do nothing;

  select id, balance into v_wallet_id, v_balance
  from public.wallets
  where user_id = v_assigned_worker_id
  for update;

  v_balance := v_balance + v_amount;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_after, related_job_id, idempotency_key, created_by
  )
  values (
    v_wallet_id, 'job_income', v_amount, v_balance, p_job_id,
    'job_income:' || p_job_id, (select auth.uid())
  );

  if v_fee_payer <> 'employer' then
    v_balance := v_balance - v_platform_fee;

    insert into public.wallet_transactions (
      wallet_id, type, amount, balance_after, related_job_id, idempotency_key, created_by
    )
    values (
      v_wallet_id, 'platform_fee', -v_platform_fee, v_balance, p_job_id,
      'platform_fee:' || p_job_id, (select auth.uid())
    );
  end if;

  update public.wallets set balance = v_balance where id = v_wallet_id;

  update public.job_assignments
  set status = 'completed'
  where job_id = p_job_id and status = 'active';

  update public.jobs set status = 'completed' where id = p_job_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'JOB_COMPLETED', 'job', p_job_id, null);
end;
$$;

revoke execute on function public.confirm_job_completion from public, anon, service_role;
grant execute on function public.confirm_job_completion to authenticated;
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

Expected: the new `job_completion_flow` migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 7: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: the file updates — diff should show `start_work`, `record_job_evidence`, `submit_job_completion`, `confirm_job_completion` appear under the `public` schema's `Functions` block, alongside the existing `get_or_create_payment`/`submit_payment_proof`/`review_payment`/`select_job_worker`/`is_admin` entries. No table gains new columns.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Task 2).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add job completion and wallet crediting atomic functions"
```

---

### Task 2: Completions service layer

**Files:**
- Create: `lib/services/completions.ts`
- Modify: `lib/services/jobs.ts` (expose `assignedWorkerId` on `JobDetail` — see Step 1)

**Interfaces:**
- Produces: `JobEvidence` (interface); `startWork(jobId)`, `recordJobEvidence(jobId, file)`, `submitJobCompletion(jobId)`, `confirmJobCompletion(jobId)`, `getJobEvidences(jobId)` — consumed by Task 4 (job-completion page + actions).
- Modifies: `JobDetail` gains `assignedWorkerId: string | null` — consumed by Task 4's page (to determine `isAssignedWorker`) and by the job-detail-page link edit in Task 4.
- Consumes: `getCurrentUser` (Phase 1's `lib/auth/get-current-user.ts`), `createClient` (Phase 1's `lib/supabase/server.ts`), `appError` (Phase 1's `lib/errors.ts`).

- [ ] **Step 1: Expose `assignedWorkerId` on `JobDetail`**

In `lib/services/jobs.ts`, the `getJobDetail` query already selects `assigned_worker_id` (line ~259) but never returns it. Add the field to the interface and the returned object:

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
}
```

And in the function's return statement, add `assignedWorkerId: job.assigned_worker_id,` after `employerId: job.employer_id,`.

- [ ] **Step 2: Write the service layer**

Create `lib/services/completions.ts`:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface JobEvidence {
  id: string
  filePath: string
  fileType: string
  uploadedAt: string
}

interface JobEvidenceRow {
  id: string
  file_path: string
  file_type: string
  created_at: string
}

function mapJobEvidenceRow(row: JobEvidenceRow): JobEvidence {
  return {
    id: row.id,
    filePath: row.file_path,
    fileType: row.file_type,
    uploadedAt: row.created_at,
  }
}

function mapStartWorkError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini belum siap untuk dikerjakan.')
  }
  return appError('INTERNAL_ERROR')
}

export async function startWork(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('start_work', { p_job_id: jobId })

  if (error) {
    throw mapStartWorkError(error.message)
  }
}

function mapRecordJobEvidenceError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini tidak dapat menerima bukti baru.')
  }
  return appError('INTERNAL_ERROR')
}

export async function recordJobEvidence(jobId: string, file: File): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const path = `${jobId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('job-evidences')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti pekerjaan.')
  }

  const { data, error } = await supabase.rpc('record_job_evidence', {
    p_job_id: jobId,
    p_file_path: path,
    p_file_type: file.type,
    p_file_size_bytes: file.size,
  })

  if (error) {
    await supabase.storage.from('job-evidences').remove([path])
    throw mapRecordJobEvidenceError(error.message)
  }

  return { id: data as string }
}

function mapSubmitJobCompletionError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('at least one evidence file required')) {
    return appError('VALIDATION_ERROR', 'Unggah minimal satu bukti pekerjaan sebelum mengajukan selesai.')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini belum siap untuk diajukan selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function submitJobCompletion(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_job_completion', { p_job_id: jobId })

  if (error) {
    throw mapSubmitJobCompletionError(error.message)
  }
}

function mapConfirmJobCompletionError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini tidak dapat dikonfirmasi selesai.')
  }
  return appError('INTERNAL_ERROR')
}

export async function confirmJobCompletion(jobId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('confirm_job_completion', { p_job_id: jobId })

  if (error) {
    throw mapConfirmJobCompletionError(error.message)
  }
}

export async function getJobEvidences(jobId: string): Promise<JobEvidence[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('job_evidences')
    .select('id, file_path, file_type, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map(mapJobEvidenceRow)
}
```

Note: every function uses `createClient()` (the auth-context client) — this file never imports `createServiceClient`. Reads rely on `job_evidences`' own correct SELECT RLS; writes go through the four RPCs, which re-derive `auth.uid()` themselves.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. This also confirms Task 1's regenerated types (with the four new functions present) are being picked up correctly.

- [ ] **Step 4: Commit**

```bash
git add lib/services/completions.ts lib/services/jobs.ts
git commit -m "feat(completions): add job completion service layer"
```

---

### Task 3: Wallet service layer

**Files:**
- Create: `lib/services/wallet.ts`

**Interfaces:**
- Produces: `WalletTransaction`, `WalletSummary` (interfaces); `getWalletForCurrentUser()` — consumed by Task 5 (wallet page).
- Consumes: `getCurrentUser` (Phase 1), `createClient` (Phase 1), `appError` (Phase 1).

- [ ] **Step 1: Write the service layer**

Create `lib/services/wallet.ts`:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface WalletTransaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  relatedJobId: string | null
  description: string | null
  createdAt: string
}

export interface WalletSummary {
  balance: number
  transactions: WalletTransaction[]
}

interface WalletTransactionRow {
  id: string
  type: string
  amount: number
  balance_after: number
  related_job_id: string | null
  description: string | null
  created_at: string
}

function mapWalletTransactionRow(row: WalletTransactionRow): WalletTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balance_after,
    relatedJobId: row.related_job_id,
    description: row.description,
    createdAt: row.created_at,
  }
}

export async function getWalletForCurrentUser(): Promise<WalletSummary> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .select('id, balance')
    .eq('user_id', user.id)
    .maybeSingle()

  if (walletError) {
    throw appError('INTERNAL_ERROR')
  }

  if (!wallet) {
    return { balance: 0, transactions: [] }
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from('wallet_transactions')
    .select('id, type, amount, balance_after, related_job_id, description, created_at')
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })

  if (transactionsError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    balance: wallet.balance,
    transactions: (transactions ?? []).map(mapWalletTransactionRow),
  }
}
```

Note: a worker with no completed jobs yet has no `wallets` row at all — `getWalletForCurrentUser` returns a zero-balance/empty-history summary in that case rather than throwing, since this is the normal, expected state for most workers most of the time (not an error condition).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/services/wallet.ts
git commit -m "feat(wallet): add wallet service layer"
```

---

### Task 4: Job-completion page (worker evidence + employer confirm)

**Files:**
- Create: `app/jobs/[id]/completion/page.tsx`
- Create: `app/jobs/[id]/completion/actions.ts`
- Create: `app/jobs/[id]/completion/evidence-upload-form.tsx`
- Create: `app/jobs/[id]/completion/submit-completion-button.tsx`
- Create: `app/jobs/[id]/completion/confirm-completion-button.tsx`
- Modify: `app/jobs/[id]/page.tsx` (add one link — see Step 5)

**Interfaces:**
- Consumes: `startWork`, `recordJobEvidence`, `submitJobCompletion`, `confirmJobCompletion`, `getJobEvidences` (Task 2); `getJobDetail` (Phase 4, now returning `assignedWorkerId` per Task 2 Step 1); `getCurrentUser` (Phase 1); `createClient` (Phase 1, for signed evidence URLs).

- [ ] **Step 1: Create the Server Actions**

Create `app/jobs/[id]/completion/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import {
  recordJobEvidence,
  submitJobCompletion,
  confirmJobCompletion,
} from '@/lib/services/completions'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4']

export type EvidenceUploadFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function recordJobEvidenceAction(
  jobId: string,
  _prevState: EvidenceUploadFormState,
  formData: FormData
): Promise<EvidenceUploadFormState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti pekerjaan wajib diunggah.'] } }
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { errors: { file: ['Format file harus JPEG, PNG, WebP, atau MP4.'] } }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { errors: { file: ['Ukuran file maksimal 20MB.'] } }
  }

  try {
    await recordJobEvidence(jobId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/completion`)
  return undefined
}

export async function submitJobCompletionAction(
  jobId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await submitJobCompletion(jobId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/completion`)
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}

export async function confirmJobCompletionAction(
  jobId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await confirmJobCompletion(jobId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/completion`)
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/wallet')
  return { success: true }
}
```

- [ ] **Step 2: Create the evidence upload form (client component)**

Create `app/jobs/[id]/completion/evidence-upload-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { recordJobEvidenceAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function EvidenceUploadForm({ jobId }: { jobId: string }) {
  const boundAction = recordJobEvidenceAction.bind(null, jobId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Pekerjaan (Foto/Video)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          required
        />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Unggah Bukti'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the submit-completion and confirm buttons (client components)**

Create `app/jobs/[id]/completion/submit-completion-button.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitJobCompletionAction } from './actions'
import { Button } from '@/components/ui/button'

export function SubmitCompletionButton({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      const result = await submitJobCompletionAction(jobId)
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
      <Button type="button" disabled={isPending} onClick={handleSubmit}>
        {isPending ? 'Memproses...' : 'Ajukan Selesai'}
      </Button>
    </div>
  )
}
```

Create `app/jobs/[id]/completion/confirm-completion-button.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmJobCompletionAction } from './actions'
import { Button } from '@/components/ui/button'

export function ConfirmCompletionButton({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await confirmJobCompletionAction(jobId)
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
      <Button type="button" disabled={isPending} onClick={handleConfirm}>
        {isPending ? 'Memproses...' : 'Konfirmasi Selesai'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 4: Create the job-completion page**

Create `app/jobs/[id]/completion/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getJobDetail } from '@/lib/services/jobs'
import { getJobEvidences, startWork } from '@/lib/services/completions'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { EvidenceUploadForm } from './evidence-upload-form'
import { SubmitCompletionButton } from './submit-completion-button'
import { ConfirmCompletionButton } from './confirm-completion-button'

const READY_STATUSES = ['payment_verified', 'in_progress', 'waiting_confirmation', 'completed']

export default async function JobCompletionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const initialJob = await getJobDetail(id)
  if (!initialJob) {
    notFound()
  }

  const isEmployer = initialJob.employerId === user.id
  const isAssignedWorker = initialJob.assignedWorkerId === user.id

  if (!isEmployer && !isAssignedWorker) {
    notFound()
  }

  if (!READY_STATUSES.includes(initialJob.status)) {
    notFound()
  }

  if (isAssignedWorker && initialJob.status === 'payment_verified') {
    await startWork(id)
  }

  const job =
    isAssignedWorker && initialJob.status === 'payment_verified'
      ? ((await getJobDetail(id)) ?? initialJob)
      : initialJob

  const evidences = await getJobEvidences(id)
  const supabase = await createClient()
  const evidencesWithUrls = await Promise.all(
    evidences.map(async (evidence) => {
      const { data } = await supabase.storage
        .from('job-evidences')
        .createSignedUrl(evidence.filePath, 60)
      return { ...evidence, signedUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Penyelesaian: {job.title}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Bukti Pekerjaan</span>
        {evidencesWithUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada bukti pekerjaan.</p>
        )}
        {evidencesWithUrls.map((evidence) => (
          <div key={evidence.id} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Diunggah {new Date(evidence.uploadedAt).toLocaleString('id-ID')}
            </span>
            {!evidence.signedUrl && (
              <p className="text-sm text-destructive">Gagal memuat bukti pekerjaan.</p>
            )}
            {evidence.signedUrl && evidence.fileType.startsWith('image/') && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
              <img src={evidence.signedUrl} alt="Bukti pekerjaan" className="max-w-full rounded border" />
            )}
            {evidence.signedUrl && evidence.fileType.startsWith('video/') && (
              <video src={evidence.signedUrl} controls className="max-w-full rounded border" />
            )}
          </div>
        ))}
      </div>
      {isAssignedWorker && job.status === 'in_progress' && (
        <>
          <EvidenceUploadForm jobId={id} />
          <SubmitCompletionButton jobId={id} />
        </>
      )}
      {isEmployer && job.status === 'waiting_confirmation' && <ConfirmCompletionButton jobId={id} />}
      {job.status === 'completed' && (
        <p className="text-sm text-green-600">Pekerjaan telah dikonfirmasi selesai.</p>
      )}
    </div>
  )
}
```

Note: `startWork` is only called once, when `initialJob.status` is exactly `'payment_verified'` — after that first successful transition, every later view already reads `'in_progress'` (or later) directly from `getJobDetail`, so there is no need to call the RPC again on every render (unlike Phase 6's `get_or_create_payment`, which had to be called unconditionally on every view because it also handles first-time row creation). This is simpler and still correct: reloading the page after the transition never re-triggers `startWork` at all, which trivially satisfies idempotency.

- [ ] **Step 5: Link to the completion page from the job detail page**

Read `app/jobs/[id]/page.tsx` first to confirm its current exact content (Phase 6 added a "Lihat Pembayaran" link; this task does not touch that block). It currently has:

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

Add this immediately after it:

```tsx
      {(isOwner || job.assignedWorkerId === user?.id) &&
        ['payment_verified', 'in_progress', 'waiting_confirmation', 'completed'].includes(
          job.status
        ) && (
          <Link
            href={`/jobs/${job.id}/completion`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Lihat Progres Pekerjaan
          </Link>
        )}
```

Unlike Phase 6's payment link (owner-only), this one must also reach the assigned worker, since they're the primary actor on the linked page.

- [ ] **Step 6: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add app/jobs
git commit -m "feat(completions): add job completion page for worker and employer"
```

---

### Task 5: Wallet page

**Files:**
- Create: `app/wallet/page.tsx`

**Interfaces:**
- Consumes: `getWalletForCurrentUser` (Task 3); `getCurrentUser` (Phase 1).

- [ ] **Step 1: Create the wallet page**

Create `app/wallet/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getWalletForCurrentUser } from '@/lib/services/wallet'

export default async function WalletPage() {
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const wallet = await getWalletForCurrentUser()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Wallet Saya</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Saldo</dt>
          <dd className="text-lg font-semibold">Rp{wallet.balance.toLocaleString('id-ID')}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Riwayat Transaksi</span>
        {wallet.transactions.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada transaksi.</p>
        )}
        <ul className="flex flex-col gap-2">
          {wallet.transactions.map((transaction) => (
            <li
              key={transaction.id}
              className="flex items-center justify-between rounded border p-3 text-sm"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{transaction.type}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(transaction.createdAt).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={transaction.amount < 0 ? 'text-destructive' : 'text-green-600'}>
                  {transaction.amount < 0 ? '-' : '+'}Rp
                  {Math.abs(transaction.amount).toLocaleString('id-ID')}
                </span>
                <span className="text-muted-foreground">
                  Saldo: Rp{transaction.balanceAfter.toLocaleString('id-ID')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
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
git add app/wallet
git commit -m "feat(wallet): add wallet balance and transaction history page"
```

---

### Task 6: Phase 7 Definition-of-Done verification

**Files:** none (verification only).

**This task must be genuinely executed with a real running app and a real browser (Playwright), not attested to from code review alone.** Playwright + Chromium are already installed on this machine — do not reinstall; if `require('playwright')` doesn't resolve directly from this worktree's `node_modules`, set `NODE_PATH` to the npx cache directory the way Phase 6's verification did (find it via `find ~/.npm/_npx -maxdepth 2 -name playwright -type d 2>/dev/null` if unsure).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should remain 59 (this phase adds no new unit tests, per the design's testing section).

- [ ] **Step 2: Create test accounts and drive two jobs to `payment_verified`**

Create 1 employer + 2 worker accounts (`phase7-employer@example.com`, `phase7-worker-a@example.com`, `phase7-worker-b@example.com`, password `password1`) via the same `auth.admin.createUser` + `user_roles` pattern used in Phase 5/6's verification. Drive **two** separate jobs all the way to `payment_verified` through the actual UI (apply → select → pay → admin verifies) — this also re-confirms Phases 4-6 still work end-to-end:

- **Job A** (assigned to worker A): create with the default `platform_fee_payer` setting (`'employer'`).
- **Job B** (assigned to worker B): before assigning, update the `platform_settings` row for `platform_fee_payer` to `'worker'` directly via SQL, drive Job B through assignment/payment/verification, then set it back to `'employer'` afterward (don't leave the platform-wide setting mutated for any other test or for real use).

You'll need an Admin account too (reuse the pattern from Phase 6's verification — a throwaway admin account works, since no Phase 6 admin credential is assumed to still exist).

- [ ] **Step 3: Verify the full flow in a real browser**

Start the dev server, wait for it to actually respond (poll, don't sleep-guess), then drive through, using **Job A** (`fee_payer = 'employer'`) unless noted otherwise:

1. Log in as worker A, visit `/jobs/[jobA-id]` — confirm a "Lihat Progres Pekerjaan" link appears (job is `payment_verified`).
2. Click it, land on `/jobs/[jobA-id]/completion` — confirm the page loads without error. Check directly against the DB: `jobs.status` is now `in_progress`. Reload the page once — confirm no error and the status still shows `in_progress` (idempotent, no duplicate side effects).
3. Attempt to click "Ajukan Selesai" (submit completion) with zero evidence uploaded yet — confirm it's rejected with a validation error message, and `jobs.status` remains `in_progress`.
4. Upload one evidence file (a JPEG) via the form — confirm it succeeds and the image renders inline on the page afterward.
5. Click "Ajukan Selesai" — confirm it succeeds, and `jobs.status` becomes `waiting_confirmation`.
6. Log in as the employer, visit `/jobs/[jobA-id]/completion` — confirm the uploaded evidence renders and a "Konfirmasi Selesai" button appears.
7. Click it — confirm it succeeds. Check directly against the DB: `jobs.status = 'completed'`, `job_assignments.status = 'completed'` for worker A's assignment, a `wallets` row now exists for worker A with `balance = payment_amount` (job A's `payment_amount`, e.g. no fee deducted since `fee_payer = 'employer'`), and exactly one `wallet_transactions` row (`type = 'job_income'`, `amount = payment_amount`) — confirm **no** `platform_fee` row was created for this job (fee_payer was `'employer'`).
8. Log in as worker A, visit `/wallet` — confirm the balance matches the job's `payment_amount` and the transaction list shows the one `job_income` entry.
9. Using **Job B** (`fee_payer = 'worker'`): repeat steps 1-5 as worker B (evidence upload + submit completion), then confirm as the employer. Check directly against the DB: worker B's `wallets.balance = payment_amount - platform_fee`, and **two** `wallet_transactions` rows exist for this job (`job_income` = `payment_amount`, then `platform_fee` = `-platform_fee`), with the final row's `balance_after` matching the wallet's stored balance exactly.
10. Log in as worker B, visit `/wallet` — confirm the balance and both transaction rows display correctly.
11. As a different, uninvolved authenticated account (a plain worker with no connection to either job), attempt to visit `/jobs/[jobA-id]/completion` directly — confirm `notFound()` (404).
12. As the employer, attempt to visit `/jobs/[jobA-id]/completion` again after it's already `completed` — confirm it still loads (read-only, showing the completed state), with no upload form or action buttons visible.

- [ ] **Step 4: Clean up the test accounts, jobs, payments, and wallet data**

Delete in FK-safe order: `wallet_transactions` → `wallets` → `job_evidences` → `payment_proofs` → `payments` → `job_applications`/`job_assignments` → `jobs` → `audit_logs` (rows generated by the throwaway admin's/employer's/workers' actions) → `user_roles` → `profiles` → `auth.users`. Also revert the `platform_fee_payer` setting back to `'employer'` if Step 2 changed it and it's still set to `'worker'`. Verify zero leftovers afterward. Stop the dev server cleanly (kill the exact PID on the port, not a broad `pkill`).

- [ ] **Step 5: Report results**

Note clearly which of Step 3's 12 checks passed, with what was actually observed (not just "pass") — mirroring Phase 6's verification report format. If any fail, do not mark Phase 7 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 7 Definition of Done

- [ ] The assigned worker's first visit to `/jobs/[id]/completion` on a `payment_verified` job lazily transitions `jobs.status` to `in_progress` (idempotent — no duplicate transitions or errors on reload).
- [ ] Submitting a completion request with zero evidence uploaded is rejected with a clear validation error.
- [ ] The worker can upload evidence (photo/video) and, once at least one exists, submit a completion request — transitioning the job to `waiting_confirmation`.
- [ ] The employer can view the evidence and confirm completion — this atomically credits the worker's wallet (creating it if it didn't exist), marks `job_assignments.status = 'completed'`, and sets `jobs.status = 'completed'`.
- [ ] Wallet crediting is correct for both `fee_payer = 'employer'` (worker gets the full amount, one `job_income` transaction, no `platform_fee` transaction) and `fee_payer = 'worker'` (worker gets `amount - platform_fee`, two transactions: `job_income` then `platform_fee`).
- [ ] The worker can view their wallet balance and transaction history at `/wallet`.
- [ ] A non-owner/non-assigned-worker cannot view `/jobs/[id]/completion` — `notFound()`, not an error page.
- [ ] No reject/rework path exists on a completion request — confirm is the only action available to the employer.
- [ ] This phase never writes to `withdrawals`.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] Step 3's full 12-check browser walkthrough was genuinely executed via Playwright, not attested to from code review.
