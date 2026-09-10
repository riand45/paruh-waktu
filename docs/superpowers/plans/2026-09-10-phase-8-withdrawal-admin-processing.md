# Phase 8 — Withdrawal Requests & Admin Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a worker request a withdrawal from their available wallet balance (with the amount held immediately), and let Admin manually process it — `pending → processing → paid` (with an uploaded transfer proof) or `pending → rejected` (which refunds the held amount) — plus the worker-facing withdrawal history and Admin's review pages.

**Architecture:** `withdrawals`/`wallet_transactions` and the `withdrawal-proofs` storage bucket already exist (Phase 6 migration), with correct SELECT-only RLS on both tables and a working INSERT(admin-only)/SELECT(owner-or-admin) RLS pair on the storage bucket. Four new `SECURITY DEFINER` Postgres functions handle every multi-table write (`request_withdrawal`, `process_withdrawal`, `reject_withdrawal`, `mark_withdrawal_paid`), mirroring the exact pattern established by Phase 6/7's functions (`review_payment`, `confirm_job_completion`) — row locks, `raise exception 'CODE: detail'`, `audit_logs` inserts, `revoke execute ... from public, anon, service_role`. `request_withdrawal` locks the caller's wallet first (serializing concurrent calls from the same user), then enforces "no duplicate pending/processing request" and "amount ≤ available balance" before debiting the wallet immediately as a hold; `reject_withdrawal` reverses that hold via a `refund`-type transaction.

**Tech Stack:** Next.js 16.3.4 (Server Actions, `useActionState`, `useTransition`, native `<form>`), Zod v4, Supabase (auth-context client throughout — no service-role client needed anywhere in this phase's service layer), Supabase CLI (`npx supabase db push`), Vitest, Playwright (already installed on this machine — reuse it, don't reinstall).

**Spec:** `docs/superpowers/specs/2026-09-10-withdrawal-admin-processing-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §27-28/§37/§40, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` §21/§29/§31 and STEP 10, and Phase 6/7's plans for schema and conventions this phase builds on.

## Global Constraints

- `withdrawals`/`wallet_transactions` have SELECT-only RLS and no write policy — every write goes through one of this phase's four `SECURITY DEFINER` functions, never a service-role client, never a plain client-side insert/update.
- **All four new RPC functions must `revoke execute ... from public, anon, service_role` (not just `public, anon`) and must be called via the regular auth-context client (`createClient()` from `lib/supabase/server.ts`), never `createServiceClient()`** — each one is `SECURITY DEFINER` and re-derives `auth.uid()`/`is_admin()` internally.
- **`request_withdrawal` prevents duplicate withdrawals**: it raises `CONFLICT` if the caller already has a `withdrawals` row with `status in ('pending', 'processing')`. It locks the caller's `wallets` row first, which serializes concurrent calls from the same user and makes this check race-free.
- **`request_withdrawal` debits the wallet immediately** (inserts a `wallet_transactions` row of `type = 'withdrawal'`, a negative amount) rather than waiting until payout — this is what makes "available balance" correctly exclude money already held by a pending/processing request.
- **`reject_withdrawal` only accepts a `withdrawals.status = 'pending'` row** — there is no reject path from `processing` in this phase (confirmed with the user). Rejecting refunds the held amount via a `wallet_transactions` row of `type = 'refund'`.
- **`mark_withdrawal_paid` only accepts a `withdrawals.status = 'processing'` row** and makes no wallet change — the amount was already debited by `request_withdrawal`.
- **Audit log action names are exactly** `WITHDRAWAL_PROCESSING` (on `process_withdrawal`), `WITHDRAWAL_PAID` (on `mark_withdrawal_paid`), `WITHDRAWAL_REJECTED` (on `reject_withdrawal`) — copied verbatim from the Implementation Prompt §31 examples.
- Reads in the service layer use the auth-context client and rely on `withdrawals`' own correct SELECT RLS — do not reimplement visibility checks in JS for this table.
- Avoid PostgREST embedded selects (`.select('*, profiles(full_name)')`) for joining the requester's name into admin withdrawal lists — use the two-query-plus-`Map` pattern already established in `lib/services/payments.ts`'s `getPendingPayments`.
- Every Server Action re-verifies authentication/authorization inside itself via the service layer — never rely on `proxy.ts`'s redirect alone.
- The transfer-proof upload flow mirrors Phase 6/7's file-upload precedent exactly: a single Server Action receives the file via `FormData`, uploads it server-side via the auth-context client, then calls the RPC to record it — attempting to roll back the uploaded object if the RPC call fails (this rollback is a known, already-accepted no-op today, since no DELETE storage policy exists on this bucket either — same already-parked limitation as Phase 6/7's uploads, not fixed here). Unlike those two precedents, **Admin** is the uploader here, not the record's owner — the `withdrawal-proofs` bucket's INSERT policy is already scoped to `is_admin()` only.
- This phase never adds a reject/rework path once `paid`, never adds a standalone refund/adjustment feature outside a withdrawal rejection, and never touches `/admin` (dashboard) or chat.

---

### Task 1: Validation schema (Zod) for the withdrawal request form

**Files:**
- Create: `lib/validations/withdrawal.ts`
- Create: `lib/validations/withdrawal.test.ts`

**Interfaces:**
- Produces: `RequestWithdrawalSchema`, `RequestWithdrawalFormState` — consumed by Task 4 (Server Action + form).

- [ ] **Step 1: Write the failing tests**

Create `lib/validations/withdrawal.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RequestWithdrawalSchema } from './withdrawal'

const validInput = {
  amount: '50000',
  bankName: 'Bank Central Asia',
  accountNumber: '1234567890',
  accountHolderName: 'Budi Santoso',
}

describe('RequestWithdrawalSchema', () => {
  it('accepts valid input and coerces amount to a number', () => {
    const result = RequestWithdrawalSchema.safeParse(validInput)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.amount).toBe(50000)
    }
  })

  it('rejects a zero amount', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, amount: '0' })
    expect(result.success).toBe(false)
  })

  it('rejects a negative amount', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, amount: '-1000' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank bank name', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, bankName: '   ' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank account number', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, accountNumber: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a blank account holder name', () => {
    const result = RequestWithdrawalSchema.safeParse({ ...validInput, accountHolderName: '' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/validations/withdrawal.test.ts
```

Expected: FAIL — `Cannot find module './withdrawal'`.

- [ ] **Step 3: Implement the schema**

Create `lib/validations/withdrawal.ts`:

```ts
import { z } from 'zod'

export const RequestWithdrawalSchema = z.object({
  amount: z.coerce
    .number({ error: 'Jumlah tidak valid.' })
    .positive({ error: 'Jumlah harus lebih dari 0.' }),
  bankName: z.string().trim().min(1, { error: 'Nama bank wajib diisi.' }),
  accountNumber: z.string().trim().min(1, { error: 'Nomor rekening wajib diisi.' }),
  accountHolderName: z.string().trim().min(1, { error: 'Nama pemilik rekening wajib diisi.' }),
})

export type RequestWithdrawalFormState =
  | {
      errors?: {
        amount?: string[]
        bankName?: string[]
        accountNumber?: string[]
        accountHolderName?: string[]
      }
      status?: 'success' | 'error'
      message?: string
    }
  | undefined
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/withdrawal.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validations/withdrawal.ts lib/validations/withdrawal.test.ts
git commit -m "feat: add Zod validation schema for withdrawal requests"
```

---

### Task 2: Database migration — atomic withdrawal functions

**Files:**
- Create: `supabase/migrations/<timestamp>_withdrawal_flow.sql`

**Interfaces:**
- Produces: `public.request_withdrawal(p_amount numeric, p_bank_name text, p_account_number text, p_account_holder_name text) returns uuid`, `public.process_withdrawal(p_withdrawal_id uuid) returns void`, `public.reject_withdrawal(p_withdrawal_id uuid, p_rejection_reason text) returns void`, `public.mark_withdrawal_paid(p_withdrawal_id uuid, p_transfer_proof_path text) returns void` — consumed by Task 3's service layer.
- Consumes: `public.wallets`, `public.wallet_transactions`, `public.withdrawals`, `public.audit_logs`, `public.is_admin()` (all Phase 1/6).

- [ ] **Step 1: Re-establish the Supabase CLI link**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

(The CLI should already have a stored login session from prior phases — if it prompts for a database password, use the one from the Supabase dashboard.)

- [ ] **Step 2: Verify the link**

```bash
npx supabase migration list
```

Expected: lists every migration through `20260910011215_fix_wallet_transaction_created_at_ordering.sql` as applied on both `Local` and `Remote`. **If anything is missing from Remote, stop and investigate before continuing.**

- [ ] **Step 3: Create the migration file**

```bash
npx supabase migration new withdrawal_flow
```

Note the generated filename (e.g. `supabase/migrations/20260910130000_withdrawal_flow.sql`) — edit that exact file in the next step.

- [ ] **Step 4: Write the migration**

Replace the file's contents with:

```sql
-- Worker requests a withdrawal from their available wallet balance.
-- Locks the caller's wallet first, which serializes concurrent calls from
-- the same user and makes the duplicate-request check below race-free.
-- Immediately debits the wallet (a hold, not deferred to payout), so
-- "available balance" always excludes money already promised to a
-- pending/processing request.
create or replace function public.request_withdrawal(
  p_amount numeric,
  p_bank_name text,
  p_account_number text,
  p_account_holder_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_id uuid;
  v_balance numeric;
  v_existing_count int;
  v_withdrawal_id uuid;
begin
  select id, balance into v_wallet_id, v_balance
  from public.wallets
  where user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'VALIDATION_ERROR: insufficient balance';
  end if;

  select count(*) into v_existing_count
  from public.withdrawals
  where user_id = (select auth.uid())
  and status in ('pending', 'processing');

  if v_existing_count > 0 then
    raise exception 'CONFLICT: an active withdrawal request already exists';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > v_balance then
    raise exception 'VALIDATION_ERROR: amount exceeds available balance';
  end if;

  if p_bank_name is null or length(trim(p_bank_name)) = 0
     or p_account_number is null or length(trim(p_account_number)) = 0
     or p_account_holder_name is null or length(trim(p_account_holder_name)) = 0 then
    raise exception 'VALIDATION_ERROR: bank details required';
  end if;

  insert into public.withdrawals (user_id, amount, bank_name, account_number, account_holder_name, status)
  values ((select auth.uid()), p_amount, p_bank_name, p_account_number, p_account_holder_name, 'pending')
  returning id into v_withdrawal_id;

  v_balance := v_balance - p_amount;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_after, related_withdrawal_id, created_by
  )
  values (
    v_wallet_id, 'withdrawal', -p_amount, v_balance, v_withdrawal_id, (select auth.uid())
  );

  update public.wallets set balance = v_balance where id = v_wallet_id;

  return v_withdrawal_id;
end;
$$;

revoke execute on function public.request_withdrawal from public, anon, service_role;
grant execute on function public.request_withdrawal to authenticated;

-- Admin moves a pending withdrawal into processing, acknowledging they
-- are now performing the manual bank transfer.
create or replace function public.process_withdrawal(p_withdrawal_id uuid)
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
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'CONFLICT: withdrawal not pending';
  end if;

  update public.withdrawals set status = 'processing' where id = p_withdrawal_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'WITHDRAWAL_PROCESSING', 'withdrawal', p_withdrawal_id, null);
end;
$$;

revoke execute on function public.process_withdrawal from public, anon, service_role;
grant execute on function public.process_withdrawal to authenticated;

-- Admin rejects a still-pending withdrawal, refunding the held amount
-- back to the requester's wallet. Only available from 'pending' -- once
-- Admin has moved a request to 'processing', the only forward path is
-- mark_withdrawal_paid (no reject-from-processing path in this phase).
create or replace function public.reject_withdrawal(
  p_withdrawal_id uuid,
  p_rejection_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_status text;
  v_wallet_id uuid;
  v_balance numeric;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_rejection_reason is null or length(trim(p_rejection_reason)) = 0 then
    raise exception 'VALIDATION_ERROR: rejection_reason required';
  end if;

  select user_id, amount, status into v_user_id, v_amount, v_status
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'CONFLICT: withdrawal not pending';
  end if;

  select id, balance into v_wallet_id, v_balance
  from public.wallets
  where user_id = v_user_id
  for update;

  v_balance := v_balance + v_amount;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_after, related_withdrawal_id, description, created_by
  )
  values (
    v_wallet_id, 'refund', v_amount, v_balance, p_withdrawal_id,
    'Withdrawal rejected: refund', (select auth.uid())
  );

  update public.wallets set balance = v_balance where id = v_wallet_id;

  update public.withdrawals
  set status = 'rejected',
      rejection_reason = p_rejection_reason,
      processed_by = (select auth.uid()),
      processed_at = now()
  where id = p_withdrawal_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'WITHDRAWAL_REJECTED', 'withdrawal', p_withdrawal_id, p_rejection_reason);
end;
$$;

revoke execute on function public.reject_withdrawal from public, anon, service_role;
grant execute on function public.reject_withdrawal to authenticated;

-- Admin records the manual transfer proof and marks a processing
-- withdrawal as paid. No wallet change here -- the amount was already
-- debited at request time by request_withdrawal.
create or replace function public.mark_withdrawal_paid(
  p_withdrawal_id uuid,
  p_transfer_proof_path text
)
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
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'processing' then
    raise exception 'CONFLICT: withdrawal not processing';
  end if;

  if p_transfer_proof_path not like p_withdrawal_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside withdrawal folder';
  end if;

  update public.withdrawals
  set status = 'paid',
      transfer_proof_path = p_transfer_proof_path,
      processed_by = (select auth.uid()),
      processed_at = now()
  where id = p_withdrawal_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'WITHDRAWAL_PAID', 'withdrawal', p_withdrawal_id, null);
end;
$$;

revoke execute on function public.mark_withdrawal_paid from public, anon, service_role;
grant execute on function public.mark_withdrawal_paid to authenticated;
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

Expected: the new `withdrawal_flow` migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 7: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: the file updates — diff should show `request_withdrawal`, `process_withdrawal`, `reject_withdrawal`, `mark_withdrawal_paid` appear under the `public` schema's `Functions` block, alongside the existing entries. No table gains new columns.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Task 3).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add withdrawal request and admin processing atomic functions"
```

---

### Task 3: Withdrawals service layer

**Files:**
- Create: `lib/services/withdrawals.ts`

**Interfaces:**
- Produces: `Withdrawal`, `AdminWithdrawalSummary`, `AdminWithdrawalDetail` (interfaces); `requestWithdrawal(amount, bankName, accountNumber, accountHolderName)`, `getWithdrawalsForCurrentUser()`, `getWithdrawalsForAdmin()`, `getWithdrawalDetailForAdmin(withdrawalId)`, `processWithdrawal(withdrawalId)`, `rejectWithdrawal(withdrawalId, rejectionReason)`, `markWithdrawalPaid(withdrawalId, file)` — consumed by Task 4 (worker wallet page) and Task 5 (admin pages).
- Consumes: `getCurrentUser`, `requireRole` (Phase 1's `lib/auth/get-current-user.ts`), `createClient` (Phase 1's `lib/supabase/server.ts`), `appError` (Phase 1's `lib/errors.ts`).

- [ ] **Step 1: Write the service layer**

Create `lib/services/withdrawals.ts`:

```ts
import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface Withdrawal {
  id: string
  amount: number
  bankName: string
  accountNumber: string
  accountHolderName: string
  status: string
  transferProofPath: string | null
  rejectionReason: string | null
  createdAt: string
}

interface WithdrawalRow {
  id: string
  amount: number
  bank_name: string
  account_number: string
  account_holder_name: string
  status: string
  transfer_proof_path: string | null
  rejection_reason: string | null
  created_at: string
}

function mapWithdrawalRow(row: WithdrawalRow): Withdrawal {
  return {
    id: row.id,
    amount: row.amount,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolderName: row.account_holder_name,
    status: row.status,
    transferProofPath: row.transfer_proof_path,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  }
}

function mapRequestWithdrawalError(message: string): Error {
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Anda masih memiliki permintaan withdrawal yang sedang diproses.')
  }
  if (message.includes('insufficient balance') || message.includes('amount exceeds')) {
    return appError('VALIDATION_ERROR', 'Jumlah withdrawal melebihi saldo yang tersedia.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR', 'Data bank tidak valid.')
  }
  return appError('INTERNAL_ERROR')
}

export async function requestWithdrawal(
  amount: number,
  bankName: string,
  accountNumber: string,
  accountHolderName: string
): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_amount: amount,
    p_bank_name: bankName,
    p_account_number: accountNumber,
    p_account_holder_name: accountHolderName,
  })

  if (error) {
    throw mapRequestWithdrawalError(error.message)
  }

  return { id: data as string }
}

export async function getWithdrawalsForCurrentUser(): Promise<Withdrawal[]> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('withdrawals')
    .select(
      'id, amount, bank_name, account_number, account_holder_name, status, transfer_proof_path, rejection_reason, created_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map(mapWithdrawalRow)
}

export interface AdminWithdrawalSummary {
  id: string
  userId: string
  userName: string
  amount: number
  status: string
  createdAt: string
}

export async function getWithdrawalsForAdmin(): Promise<AdminWithdrawalSummary[]> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: withdrawals, error } = await supabase
    .from('withdrawals')
    .select('id, user_id, amount, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = withdrawals ?? []
  const statusOrder: Record<string, number> = {
    pending: 0,
    processing: 1,
    rejected: 2,
    paid: 3,
  }
  rows.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4))

  if (rows.length === 0) {
    return []
  }

  const userIds = rows.map((row) => row.user_id)
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds)

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: nameById.get(row.user_id) ?? 'Tidak diketahui',
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
  }))
}

export interface AdminWithdrawalDetail extends Withdrawal {
  userId: string
  userName: string
}

export async function getWithdrawalDetailForAdmin(
  withdrawalId: string
): Promise<AdminWithdrawalDetail | null> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: withdrawal, error } = await supabase
    .from('withdrawals')
    .select(
      'id, user_id, amount, bank_name, account_number, account_holder_name, status, transfer_proof_path, rejection_reason, created_at'
    )
    .eq('id', withdrawalId)
    .maybeSingle()

  if (error || !withdrawal) {
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', withdrawal.user_id)
    .maybeSingle()

  if (profileError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    ...mapWithdrawalRow(withdrawal),
    userId: withdrawal.user_id,
    userName: profile?.full_name ?? 'Tidak diketahui',
  }
}

function mapProcessWithdrawalError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Withdrawal ini sudah diproses sebelumnya.')
  }
  return appError('INTERNAL_ERROR')
}

export async function processWithdrawal(withdrawalId: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('process_withdrawal', { p_withdrawal_id: withdrawalId })

  if (error) {
    throw mapProcessWithdrawalError(error.message)
  }
}

function mapRejectWithdrawalError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('rejection_reason required')) {
    return appError('VALIDATION_ERROR', 'Alasan penolakan wajib diisi.')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Withdrawal ini sudah tidak dapat ditolak.')
  }
  return appError('INTERNAL_ERROR')
}

export async function rejectWithdrawal(withdrawalId: string, rejectionReason: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('reject_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_rejection_reason: rejectionReason,
  })

  if (error) {
    throw mapRejectWithdrawalError(error.message)
  }
}

function mapMarkWithdrawalPaidError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Withdrawal ini belum siap untuk ditandai lunas.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function markWithdrawalPaid(withdrawalId: string, file: File): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()
  const path = `${withdrawalId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('withdrawal-proofs')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti transfer.')
  }

  const { error } = await supabase.rpc('mark_withdrawal_paid', {
    p_withdrawal_id: withdrawalId,
    p_transfer_proof_path: path,
  })

  if (error) {
    await supabase.storage.from('withdrawal-proofs').remove([path])
    throw mapMarkWithdrawalPaidError(error.message)
  }
}
```

Note: every function uses `createClient()` (the auth-context client) — this file never imports `createServiceClient`. Reads rely on `withdrawals`' own correct SELECT RLS; writes go through the four RPCs, which re-derive `auth.uid()`/`is_admin()` themselves.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. This also confirms Task 2's regenerated types (with the four new functions present) are being picked up correctly.

- [ ] **Step 3: Commit**

```bash
git add lib/services/withdrawals.ts
git commit -m "feat(withdrawals): add withdrawal service layer"
```

---

### Task 4: Worker wallet page — request withdrawal + history

**Files:**
- Modify: `app/wallet/page.tsx`
- Create: `app/wallet/actions.ts`
- Create: `app/wallet/request-withdrawal-form.tsx`

**Interfaces:**
- Consumes: `getWithdrawalsForCurrentUser`, `requestWithdrawal` (Task 3); `getWalletForCurrentUser` (Phase 7's `lib/services/wallet.ts`); `createClient` (Phase 1, for signed transfer-proof URLs).

- [ ] **Step 1: Create the Server Action**

Create `app/wallet/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requestWithdrawal } from '@/lib/services/withdrawals'
import { RequestWithdrawalSchema, type RequestWithdrawalFormState } from '@/lib/validations/withdrawal'
import { toSafeErrorMessage } from '@/lib/errors'

export async function requestWithdrawalAction(
  _prevState: RequestWithdrawalFormState,
  formData: FormData
): Promise<RequestWithdrawalFormState> {
  const validatedFields = RequestWithdrawalSchema.safeParse({
    amount: formData.get('amount'),
    bankName: formData.get('bankName'),
    accountNumber: formData.get('accountNumber'),
    accountHolderName: formData.get('accountHolderName'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await requestWithdrawal(
      validatedFields.data.amount,
      validatedFields.data.bankName,
      validatedFields.data.accountNumber,
      validatedFields.data.accountHolderName
    )
  } catch (error) {
    return { status: 'error', message: toSafeErrorMessage(error) }
  }

  revalidatePath('/wallet')
  return { status: 'success', message: 'Permintaan withdrawal berhasil diajukan.' }
}
```

- [ ] **Step 2: Create the request-withdrawal form (client component)**

Create `app/wallet/request-withdrawal-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { requestWithdrawalAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RequestWithdrawalForm({ balance }: { balance: number }) {
  const [state, action, pending] = useActionState(requestWithdrawalAction, undefined)

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="amount">Jumlah (maks. Rp{balance.toLocaleString('id-ID')})</Label>
        <Input id="amount" name="amount" type="number" min="1" max={balance} step="1" required />
        {state?.errors?.amount && <p className="text-sm text-destructive">{state.errors.amount[0]}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bankName">Nama Bank</Label>
        <Input id="bankName" name="bankName" required />
        {state?.errors?.bankName && <p className="text-sm text-destructive">{state.errors.bankName[0]}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accountNumber">Nomor Rekening</Label>
        <Input id="accountNumber" name="accountNumber" required />
        {state?.errors?.accountNumber && (
          <p className="text-sm text-destructive">{state.errors.accountNumber[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accountHolderName">Nama Pemilik Rekening</Label>
        <Input id="accountHolderName" name="accountHolderName" required />
        {state?.errors?.accountHolderName && (
          <p className="text-sm text-destructive">{state.errors.accountHolderName[0]}</p>
        )}
      </div>
      {state?.message && (
        <p
          className={
            state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengajukan...' : 'Ajukan Withdrawal'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Extend the wallet page**

Read `app/wallet/page.tsx` first to confirm its current exact content (shown in full below reflects Phase 7's existing balance/transaction-history sections, which this step keeps unchanged, plus two new sections appended after them). Replace the whole file with:

```tsx
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getWalletForCurrentUser } from '@/lib/services/wallet'
import { getWithdrawalsForCurrentUser } from '@/lib/services/withdrawals'
import { createClient } from '@/lib/supabase/server'
import { RequestWithdrawalForm } from './request-withdrawal-form'

export default async function WalletPage() {
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const wallet = await getWalletForCurrentUser()
  const withdrawals = await getWithdrawalsForCurrentUser()
  const hasActiveWithdrawal = withdrawals.some(
    (withdrawal) => withdrawal.status === 'pending' || withdrawal.status === 'processing'
  )

  const supabase = await createClient()
  const withdrawalsWithUrls = await Promise.all(
    withdrawals.map(async (withdrawal) => {
      if (!withdrawal.transferProofPath) {
        return { ...withdrawal, signedUrl: null as string | null }
      }
      const { data } = await supabase.storage
        .from('withdrawal-proofs')
        .createSignedUrl(withdrawal.transferProofPath, 60)
      return { ...withdrawal, signedUrl: data?.signedUrl ?? null }
    })
  )

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
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Ajukan Withdrawal</span>
        {hasActiveWithdrawal && (
          <p className="text-sm text-muted-foreground">
            Anda masih memiliki permintaan withdrawal yang sedang diproses.
          </p>
        )}
        {!hasActiveWithdrawal && <RequestWithdrawalForm balance={wallet.balance} />}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Riwayat Withdrawal</span>
        {withdrawalsWithUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada permintaan withdrawal.</p>
        )}
        <ul className="flex flex-col gap-2">
          {withdrawalsWithUrls.map((withdrawal) => (
            <li key={withdrawal.id} className="flex flex-col gap-1 rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Rp{withdrawal.amount.toLocaleString('id-ID')}</span>
                <span className="text-muted-foreground">{withdrawal.status}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {withdrawal.bankName} - {withdrawal.accountNumber} a.n. {withdrawal.accountHolderName}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(withdrawal.createdAt).toLocaleString('id-ID')}
              </span>
              {withdrawal.status === 'rejected' && withdrawal.rejectionReason && (
                <p className="text-sm text-destructive">Alasan penolakan: {withdrawal.rejectionReason}</p>
              )}
              {withdrawal.status === 'paid' && withdrawal.signedUrl && (
                <a
                  href={withdrawal.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Lihat Bukti Transfer
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/wallet
git commit -m "feat(wallet): add withdrawal request form and history to wallet page"
```

---

### Task 5: Admin withdrawal review pages

**Files:**
- Create: `app/admin/withdrawals/page.tsx`
- Create: `app/admin/withdrawals/[id]/page.tsx`
- Create: `app/admin/withdrawals/[id]/process-reject-form.tsx`
- Create: `app/admin/withdrawals/[id]/mark-paid-form.tsx`
- Create: `app/admin/withdrawals/[id]/actions.ts`

**Interfaces:**
- Consumes: `getWithdrawalsForAdmin`, `getWithdrawalDetailForAdmin`, `processWithdrawal`, `rejectWithdrawal`, `markWithdrawalPaid` (Task 3); `requireAdminOr404` (Phase 1); `createClient` (Phase 1, for the signed transfer-proof URL).

- [ ] **Step 1: Create the Server Actions**

Create `app/admin/withdrawals/[id]/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { processWithdrawal, rejectWithdrawal, markWithdrawalPaid } from '@/lib/services/withdrawals'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export async function processWithdrawalAction(
  withdrawalId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await processWithdrawal(withdrawalId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/withdrawals')
  revalidatePath(`/admin/withdrawals/${withdrawalId}`)
  return { success: true }
}

export async function rejectWithdrawalAction(
  withdrawalId: string,
  rejectionReason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await rejectWithdrawal(withdrawalId, rejectionReason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/withdrawals')
  revalidatePath(`/admin/withdrawals/${withdrawalId}`)
  revalidatePath('/wallet')
  return { success: true }
}

export type MarkWithdrawalPaidFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function markWithdrawalPaidAction(
  withdrawalId: string,
  _prevState: MarkWithdrawalPaidFormState,
  formData: FormData
): Promise<MarkWithdrawalPaidFormState> {
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
    await markWithdrawalPaid(withdrawalId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/withdrawals')
  revalidatePath(`/admin/withdrawals/${withdrawalId}`)
  revalidatePath('/wallet')
  return undefined
}
```

- [ ] **Step 2: Create the process/reject form (client component)**

Create `app/admin/withdrawals/[id]/process-reject-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { processWithdrawalAction, rejectWithdrawalAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProcessRejectForm({ withdrawalId }: { withdrawalId: string }) {
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleProcess() {
    setError(null)
    startTransition(async () => {
      const result = await processWithdrawalAction(withdrawalId)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  function handleReject() {
    setError(null)
    if (rejectionReason.trim().length === 0) {
      setError('Alasan penolakan wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = await rejectWithdrawalAction(withdrawalId, rejectionReason)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/withdrawals')
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
        <Button type="button" disabled={isPending} onClick={handleProcess}>
          {isPending ? 'Memproses...' : 'Proses'}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={handleReject}>
          {isPending ? 'Memproses...' : 'Tolak'}
        </Button>
      </div>
    </div>
  )
}
```

Note: "Proses" calls `router.refresh()` (stays on the same page, which now re-renders showing `MarkPaidForm` since the status is `processing`), while "Tolak" is terminal and pushes back to the list — mirroring how Phase 7's `SubmitCompletionButton` (non-terminal, refreshes) and Phase 6's `ReviewForm` (terminal, redirects) each behave.

- [ ] **Step 3: Create the mark-paid form (client component)**

Create `app/admin/withdrawals/[id]/mark-paid-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { markWithdrawalPaidAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function MarkPaidForm({ withdrawalId }: { withdrawalId: string }) {
  const boundAction = markWithdrawalPaidAction.bind(null, withdrawalId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Transfer</Label>
        <Input id="file" name="file" type="file" accept="image/jpeg,image/png,application/pdf" required />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Tandai Lunas'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 4: Create the admin withdrawals list page**

Create `app/admin/withdrawals/page.tsx`:

```tsx
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getWithdrawalsForAdmin } from '@/lib/services/withdrawals'

export default async function AdminWithdrawalsPage() {
  await requireAdminOr404()
  const withdrawals = await getWithdrawalsForAdmin()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Withdrawal</h1>
      {withdrawals.length === 0 && <p className="text-sm text-muted-foreground">Belum ada withdrawal.</p>}
      <ul className="flex flex-col gap-2">
        {withdrawals.map((withdrawal) => (
          <li key={withdrawal.id}>
            <Link
              href={`/admin/withdrawals/${withdrawal.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span className="font-medium">{withdrawal.userName}</span>
              <div className="flex flex-col items-end gap-1">
                <span>Rp{withdrawal.amount.toLocaleString('id-ID')}</span>
                <span className="text-muted-foreground">{withdrawal.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Create the admin withdrawal detail page**

Create `app/admin/withdrawals/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getWithdrawalDetailForAdmin } from '@/lib/services/withdrawals'
import { createClient } from '@/lib/supabase/server'
import { ProcessRejectForm } from './process-reject-form'
import { MarkPaidForm } from './mark-paid-form'

export default async function AdminWithdrawalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const withdrawal = await getWithdrawalDetailForAdmin(id)
  if (!withdrawal) {
    notFound()
  }

  let signedUrl: string | null = null
  if (withdrawal.transferProofPath) {
    const supabase = await createClient()
    const { data } = await supabase.storage
      .from('withdrawal-proofs')
      .createSignedUrl(withdrawal.transferProofPath, 60)
    signedUrl = data?.signedUrl ?? null
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Withdrawal: {withdrawal.userName}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Jumlah</dt>
          <dd className="text-lg font-semibold">Rp{withdrawal.amount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bank</dt>
          <dd>{withdrawal.bankName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nomor Rekening</dt>
          <dd>{withdrawal.accountNumber}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Atas Nama</dt>
          <dd>{withdrawal.accountHolderName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{withdrawal.status}</dd>
        </div>
        {withdrawal.rejectionReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Penolakan</dt>
            <dd>{withdrawal.rejectionReason}</dd>
          </div>
        )}
      </dl>
      {signedUrl && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Bukti Transfer</span>
          {/\.(jpg|jpeg|png)$/i.test(withdrawal.transferProofPath ?? '') ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
            <img src={signedUrl} alt="Bukti transfer" className="max-w-full rounded border" />
          ) : (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Lihat Bukti Transfer (PDF)
            </a>
          )}
        </div>
      )}
      {withdrawal.status === 'pending' && <ProcessRejectForm withdrawalId={withdrawal.id} />}
      {withdrawal.status === 'processing' && <MarkPaidForm withdrawalId={withdrawal.id} />}
    </div>
  )
}
```

- [ ] **Step 6: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add app/admin/withdrawals
git commit -m "feat(admin): add withdrawal review and processing pages"
```

---

### Task 6: Phase 8 Definition-of-Done verification

**Files:** none (verification only).

**This task must be genuinely executed with a real running app and a real browser (Playwright), not attested to from code review alone.** Playwright + Chromium are already installed on this machine — do not reinstall; if `require('playwright')` doesn't resolve directly from this worktree's `node_modules`, set `NODE_PATH` to the npx cache directory the way prior phases' verification did (find it via `find ~/.npm/_npx -maxdepth 2 -name playwright -type d 2>/dev/null` if unsure).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be 59 (current total) + Task 1's 6 = 65.

- [ ] **Step 2: Create test accounts and a worker with an existing wallet balance**

Create 1 admin + 1 worker account (`phase8-admin@example.com`, `phase8-worker@example.com`, password `password1`) via the same `auth.admin.createUser` + `user_roles` pattern used in prior phases' verification. Give the worker a wallet balance either by driving a job all the way to `completed` through the actual UI (recommended, since it also re-confirms Phases 4-7 still work end-to-end — see Phase 7's verification Step 2-3 for the exact sequence), or, if faster, by directly inserting a `wallets` row (`balance = 200000`) for the worker via SQL. Either way, end this step with the worker having a `wallets.balance` of at least `200000`.

- [ ] **Step 3: Verify the full flow in a real browser**

Start the dev server, wait for it to actually respond (poll, don't sleep-guess), then drive through:

1. Log in as the worker, visit `/wallet` — confirm the balance shows correctly and a "Ajukan Withdrawal" form is visible (no active withdrawal yet).
2. Attempt to submit the form with an amount greater than the balance (e.g. balance + 100000) — confirm it is rejected with a clear error message (`VALIDATION_ERROR`, "Jumlah withdrawal melebihi saldo yang tersedia.") and no `withdrawals` row is created.
3. Submit the form with a valid amount (e.g. 100000) and bank details — confirm it succeeds, the balance on `/wallet` decreases by that amount, a `wallet_transactions` row appears (`type = 'withdrawal'`, `amount = -100000`), and the "Riwayat Withdrawal" section shows the new request with `status = 'pending'`.
4. Reload `/wallet` — confirm the request form is now replaced by the "Anda masih memiliki permintaan withdrawal yang sedang diproses." notice (duplicate-request prevention surfaced in the UI).
5. Log in as Admin, visit `/admin/withdrawals` — confirm the new withdrawal appears, showing the worker's name, amount, and `pending` status.
6. Click into it, confirm the full bank details display correctly, then click "Tolak" without entering a reason — confirm a client-side validation error appears and nothing is submitted. Enter a reason and click "Tolak" again — confirm it succeeds, redirects to the list, and the withdrawal now shows `rejected`. Check directly against the DB: a `wallet_transactions` row of `type = 'refund'` exists for the held amount, and the worker's `wallets.balance` is back to its original value.
7. Log in as the worker, revisit `/wallet` — confirm the balance is restored, the "Ajukan Withdrawal" form is visible again (no active request), and the withdrawal history shows the rejected request with its rejection reason.
8. Submit a second withdrawal request (same amount, new bank details) — confirm it succeeds.
9. Log in as Admin, open the new withdrawal, click "Proses" — confirm it succeeds, the page now shows a "Tandai Lunas" file-upload form instead of the process/reject buttons, and the withdrawal's status is `processing` (check directly against the DB or by reloading the page).
10. Upload a transfer-proof file (a JPEG) and click "Tandai Lunas" — confirm it succeeds, and the withdrawal now shows `paid` with the uploaded proof rendering inline.
11. Log in as the worker, revisit `/wallet` — confirm the withdrawal history shows the request as `paid` with a working "Lihat Bukti Transfer" link, and the wallet balance was **not** changed by this step (it was already debited at request time in Step 3).
12. As a different, uninvolved authenticated account (a plain worker with no withdrawals), attempt to visit `/wallet` — confirm they see only their own (empty) withdrawal history, never the other worker's data.
13. As a plain (non-admin) authenticated account, attempt to visit `/admin/withdrawals` and `/admin/withdrawals/[id]` (using the paid withdrawal's id) directly — confirm both return `notFound()` (404), matching `requireAdminOr404`'s established behavior.

- [ ] **Step 4: Clean up the test accounts and data**

Delete in FK-safe order: `wallet_transactions` → `withdrawals` → `wallets` (if created solely for this test) → `audit_logs` (rows generated by the throwaway admin's/worker's actions) → `user_roles` → `profiles` → `auth.users`. If Step 2 drove a job through completion, also clean up that job's `payment_proofs`/`payments`/`job_applications`/`job_assignments`/`jobs` rows in the same FK-safe order prior phases' verification used. Verify zero leftovers afterward. Stop the dev server cleanly (kill the exact PID on the port, not a broad `pkill`).

- [ ] **Step 5: Report results**

Note clearly which of Step 3's 13 checks passed, with what was actually observed (not just "pass") — mirroring prior phases' verification report format. If any fail, do not mark Phase 8 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 8 Definition of Done

- [ ] A worker can request a withdrawal within their available balance; the wallet is debited immediately (a hold) and a `wallet_transactions` row of `type = 'withdrawal'` is created.
- [ ] Requesting more than the available balance is rejected server-side with a clear validation error.
- [ ] A worker cannot have two `pending`/`processing` withdrawal requests at once — the request form is hidden and a fresh request attempt is rejected with `CONFLICT` while one is outstanding.
- [ ] Admin can view all withdrawals at `/admin/withdrawals` (pending/processing first) with the requester's name, amount, and status.
- [ ] Admin can move a `pending` withdrawal to `processing`, or reject it (with a required reason) — rejecting refunds the held amount via a `wallet_transactions` row of `type = 'refund'`.
- [ ] Admin can upload a transfer proof for a `processing` withdrawal and mark it `paid` — no wallet change occurs at this step.
- [ ] The worker can see their withdrawal history (including status, rejection reason, and the transfer proof once paid) on `/wallet`.
- [ ] `audit_logs` gains one row per `process_withdrawal`/`reject_withdrawal`/`mark_withdrawal_paid` call, with action names `WITHDRAWAL_PROCESSING`/`WITHDRAWAL_REJECTED`/`WITHDRAWAL_PAID`.
- [ ] A non-admin cannot view `/admin/withdrawals` or `/admin/withdrawals/[id]` — `notFound()`, not an error page.
- [ ] No reject path exists from `processing` — once Admin starts processing, the only forward action is marking it paid.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] Step 3's full 13-check browser walkthrough was genuinely executed via Playwright, not attested to from code review.
