# Withdrawal Requests & Admin Processing — Design

## 1. Purpose

Implement the PRD's "STEP 10 — Withdrawal" (worker withdrawal requests, manual Admin processing, paid/rejected states, audit log) — the next unbuilt piece of the core business flow after Phase 7's job completion & wallet crediting. Matches PRD §27-28/§37/§40 and the Implementation Prompt's §21/§29/§31/STEP 10.

Core flow (PRD §27):

```
Worker Request Withdrawal → Admin Review → Admin Transfer Manual →
Upload Transfer Proof → Paid
                       ↳ (from Review) Rejected
```

Statuses: `pending → processing → paid`, or `pending → rejected`.

## 2. Out of scope (explicitly deferred)

- **Standalone refund/adjustment transactions** (PRD §22, Implementation Prompt §22 "REFUND") — the only refund this phase creates is the automatic one tied to a rejected withdrawal. Admin-initiated refunds unrelated to a withdrawal are a separate, later concern.
- **Admin dashboard aggregate stats** (Implementation Prompt §25 lists "pending withdrawals" as a dashboard tile) — this phase adds `/admin/withdrawals`, not `/admin` itself.
- **Reject-from-`processing`** — confirmed with the user: once Admin moves a request to `processing`, the only forward path is marking it `paid`. If a manual transfer fails after that point, no in-app recovery path exists yet (would need direct DB access) — a known gap, consistent with this project's practice of not building reject/rework paths the PRD/Implementation Prompt doesn't explicitly call for (Phase 7's job-completion confirm step made the same call).
- **Saved bank accounts.** The `withdrawals` table (already created in Phase 6) stores `bank_name`/`account_number`/`account_holder_name` directly on each request row — there is no separate bank-accounts table, so the worker types these fresh on every request, matching the schema as built.
- **Chat, admin dashboard, categories, settings UI** — everything else in STEP 11/12, untouched here.

## 3. What already exists (Phase 6), reused as-is

All schema for this phase was created in Phase 6's `supabase/migrations/20260907101332_payments_and_wallet.sql` and `20260907102700_storage_buckets.sql` — no new tables, no new storage buckets, no new RLS policies. Only four new functions (§4).

- **`withdrawals`**: `id, user_id, amount, bank_name, account_number, account_holder_name, status ('pending'|'processing'|'paid'|'rejected'), transfer_proof_path, rejection_reason, processed_by, processed_at, created_at, updated_at`. SELECT-only RLS (`withdrawals_select_own_or_admin`: own row or admin) — no write policy, matching the established "writes go through a SECURITY DEFINER function" rule.
- **`wallet_transactions.type`** CHECK constraint already includes `'withdrawal'` and `'refund'` (alongside `job_income`/`platform_fee`/`adjustment`), and the table already has `related_withdrawal_id`. Nothing has written either value yet — this phase is the first.
- **`withdrawal-proofs` storage bucket**: already exists (private, 10MB, `image/jpeg`/`image/png`/`application/pdf`), with a working RLS pair already scoped correctly for this exact flow: SELECT for the withdrawal's owner or admin, INSERT restricted to `is_admin()` only (the worker never uploads to this bucket — Admin does, since Admin performs the manual transfer).
- **`wallets`**: `id, user_id (unique), balance, created_at, updated_at`. Already populated for any worker who has completed a job (Phase 7).
- **`confirm_job_completion`** (Phase 7) is the direct precedent for locking a wallet row, computing a new `balance_after`, and inserting a `wallet_transactions` row inside a larger `SECURITY DEFINER` transaction. **`review_payment`** (Phase 6) is the direct precedent for `process_withdrawal`/`reject_withdrawal`'s shape: admin-only, row-lock, status-guard, `audit_logs` insert. **`submit_payment_proof`** (Phase 6) is the direct precedent for `mark_withdrawal_paid`'s file-path-containment check.

## 4. Database changes (new migration)

Four new `SECURITY DEFINER` functions, all callable via `supabase.rpc()`. All four: `security definer`, `set search_path = ''`, fully-qualified `public.` references, `revoke execute ... from public, anon, service_role; grant execute ... to authenticated;`.

### 4.1 `request_withdrawal(p_amount numeric, p_bank_name text, p_account_number text, p_account_holder_name text) returns uuid`

1. Lock the caller's `wallets` row (`where user_id = (select auth.uid())`); if none exists, raise `VALIDATION_ERROR: insufficient balance` (a worker with no wallet row has never earned anything). Locking here first serializes concurrent calls from the same user, making steps 2-3 below race-free.
2. **Prevent duplicate withdrawal** (Implementation Prompt §21): if a `withdrawals` row already exists for this user with `status in ('pending', 'processing')`, raise `CONFLICT: an active withdrawal request already exists`.
3. Validate `p_amount > 0` and `p_amount <= wallets.balance` — else `VALIDATION_ERROR` (the balance check is the PRD §28 rule: "user tidak dapat melakukan withdrawal melebihi saldo yang tersedia").
4. Validate `p_bank_name`/`p_account_number`/`p_account_holder_name` are all non-blank (trimmed) — else `VALIDATION_ERROR`.
5. Insert the `withdrawals` row (`status = 'pending'`), returning its `id`.
6. **Debit the wallet immediately** (a hold, not deferred to payout): insert a `wallet_transactions` row (`type = 'withdrawal'`, `amount = -p_amount`, `balance_after = wallets.balance - p_amount`, `related_withdrawal_id` = the new row, `created_by = auth.uid()`), then update `wallets.balance` to that value. This is what makes "available balance" always exclude money already promised to a pending/processing request.
7. Return the new `withdrawals.id`.

### 4.2 `process_withdrawal(p_withdrawal_id uuid) returns void`

1. `if not public.is_admin() then raise exception 'FORBIDDEN'`.
2. Lock the withdrawal row; `NOT_FOUND` if missing; `CONFLICT` if `status <> 'pending'`.
3. Update `status = 'processing'`.
4. Insert one `audit_logs` row (`action = 'WITHDRAWAL_PROCESSING'`, `entity_type = 'withdrawal'`, `description = null`) — matching the Implementation Prompt §31 audit-action name exactly.

### 4.3 `reject_withdrawal(p_withdrawal_id uuid, p_rejection_reason text) returns void`

1. `if not public.is_admin() then raise exception 'FORBIDDEN'`.
2. Require non-empty `p_rejection_reason` → `VALIDATION_ERROR`.
3. Lock the withdrawal row; `NOT_FOUND` if missing; `CONFLICT` if `status <> 'pending'` (per §2 — reject is only available before Admin starts processing).
4. Lock the requester's `wallets` row; **refund the held amount**: insert a `wallet_transactions` row (`type = 'refund'`, `amount = +withdrawals.amount`, `balance_after = wallets.balance + withdrawals.amount`, `related_withdrawal_id = p_withdrawal_id`, `description = 'Withdrawal rejected: refund'`, `created_by = auth.uid()`), update `wallets.balance` accordingly.
5. Update the withdrawal: `status = 'rejected'`, `rejection_reason = p_rejection_reason`, `processed_by = auth.uid()`, `processed_at = now()`.
6. Insert one `audit_logs` row (`action = 'WITHDRAWAL_REJECTED'`, `entity_type = 'withdrawal'`, `description = p_rejection_reason`).

### 4.4 `mark_withdrawal_paid(p_withdrawal_id uuid, p_transfer_proof_path text) returns void`

1. `if not public.is_admin() then raise exception 'FORBIDDEN'`.
2. Lock the withdrawal row; `NOT_FOUND` if missing; `CONFLICT` if `status <> 'processing'`.
3. Validate `p_transfer_proof_path` stays inside the withdrawal's own folder (`p_transfer_proof_path like p_withdrawal_id::text || '/%'`) — the same file-path-containment check Phase 6/7 apply to every upload-recording RPC.
4. Update the withdrawal: `status = 'paid'`, `transfer_proof_path = p_transfer_proof_path`, `processed_by = auth.uid()`, `processed_at = now()`. No wallet change — the amount was already debited at request time (§4.1).
5. Insert one `audit_logs` row (`action = 'WITHDRAWAL_PAID'`, `entity_type = 'withdrawal'`, `description = null`).

## 5. Application layer

### 5.1 Validation (`lib/validations/withdrawal.ts`)

```ts
RequestWithdrawalSchema = z.object({
  amount: z.coerce.number({ error: 'Jumlah tidak valid.' }).positive({ error: 'Jumlah harus lebih dari 0.' }),
  bankName: z.string().trim().min(1, 'Nama bank wajib diisi.'),
  accountNumber: z.string().trim().min(1, 'Nomor rekening wajib diisi.'),
  accountHolderName: z.string().trim().min(1, 'Nama pemilik rekening wajib diisi.'),
})
```

No schema for the rejection reason — validated inline in the client form and re-validated inside `reject_withdrawal` itself, mirroring `review_payment`'s exact precedent (no Zod schema exists for that field either).

### 5.2 Service layer (`lib/services/withdrawals.ts`)

Auth-context only (`createClient()`), no service-role client anywhere in this file — every RPC re-derives `auth.uid()`/`is_admin()` itself, and every read relies on the table's own correct SELECT RLS, same as `payments.ts`/`completions.ts`.

- `requestWithdrawal(amount, bankName, accountNumber, accountHolderName): Promise<{ id: string }>` — calls `request_withdrawal`; maps `CONFLICT` → "Anda masih memiliki permintaan withdrawal yang sedang diproses.", `VALIDATION_ERROR` (insufficient balance) → a specific message, else generic.
- `getWithdrawalsForCurrentUser(): Promise<WithdrawalSummary[]>` — plain read of the caller's own `withdrawals` rows, newest first.
- `getWithdrawalsForAdmin(): Promise<AdminWithdrawalSummary[]>` — `requireRole('admin')`, reads all `withdrawals`, sorted `pending:0, processing:1, rejected:2, paid:3` then newest first (mirrors `getPendingPayments`' ordering), joined in-app with `profiles.full_name` (same two-query-then-map-by-id pattern `getPendingPayments` already uses — no FK-embed convention exists in this codebase).
- `getWithdrawalDetailForAdmin(withdrawalId): Promise<AdminWithdrawalDetail | null>` — `requireRole('admin')`, single row + requester's `full_name`.
- `processWithdrawal(withdrawalId): Promise<void>` — calls `process_withdrawal`.
- `rejectWithdrawal(withdrawalId, rejectionReason): Promise<void>` — calls `reject_withdrawal`.
- `markWithdrawalPaid(withdrawalId, file): Promise<void>` — uploads `file` to `withdrawal-proofs/${withdrawalId}/${Date.now()}-${file.name}` via the auth-context client (the bucket's own INSERT policy already restricts this to `is_admin()`), then calls `mark_withdrawal_paid`; on RPC failure, attempts to remove the uploaded object (same compensating-delete shape as `submitPaymentProof`/`recordJobEvidence` — including their same known, already-parked limitation: no DELETE storage policy exists on this bucket either, so the removal call is currently a no-op; not addressed in this phase).

### 5.3 Routes

- **`app/wallet/page.tsx`** (existing, extended) — alongside the existing balance/transaction history, fetch `getWithdrawalsForCurrentUser()`. Render `RequestWithdrawalForm` only when the worker has no `pending`/`processing` request outstanding (surfacing the duplicate-prevention rule in the UI, not just as a server error); otherwise show a notice that one is already in progress. Render a "Riwayat Withdrawal" list showing each request's amount/bank/status/rejection reason, and — for `paid` requests — a signed-URL link/image to the transfer proof (60s expiry, same branching as the admin payments detail page: image inline, PDF as a link).
- **`app/wallet/actions.ts`** (new) — `requestWithdrawalAction`, a `useActionState`/`FormData` Server Action validating with `RequestWithdrawalSchema` then calling the service function, mirroring `updateProfileAction`'s exact shape (`{ errors?, message?, status? }`).
- **`app/wallet/request-withdrawal-form.tsx`** (new) — client component, `useActionState`, structurally identical to `ProfileForm` (four labeled inputs, per-field errors, a submit button).
- **`app/admin/withdrawals/page.tsx`** (new) — list of all withdrawals (pending/processing first), mirroring `app/admin/payments/page.tsx`: requester name, amount, status.
- **`app/admin/withdrawals/[id]/page.tsx`** (new) — detail: requester name, amount, full bank details (bank name/account number/account holder), status, rejection reason if rejected, and the transfer proof (signed URL, same image/PDF branching as admin payments) if paid. Renders `ProcessRejectForm` while `pending`, `MarkPaidForm` while `processing`, nothing (a static status message) once `paid`/`rejected`.
- **`app/admin/withdrawals/[id]/process-reject-form.tsx`** (new) — client component, `useTransition`, structurally identical to `ReviewForm` (a rejection-reason input plus "Proses"/"Tolak" buttons, client-side non-empty check before calling `rejectWithdrawalAction`).
- **`app/admin/withdrawals/[id]/mark-paid-form.tsx`** (new) — client component, `useActionState`/`FormData`, structurally identical to `PaymentProofForm` (a single file input, MIME/size validated in the action).
- **`app/admin/withdrawals/[id]/actions.ts`** (new) — `processWithdrawalAction`/`rejectWithdrawalAction` (direct-args, `{ success, message }` shape, mirroring `reviewPaymentAction`) and `markWithdrawalPaidAction` (`FormData`, mirroring `submitPaymentProofAction`'s file-validation-then-service-call shape).

## 6. Error handling

| Situation | Error |
|---|---|
| `request_withdrawal` with no wallet row / balance | `VALIDATION_ERROR` |
| `request_withdrawal` while a `pending`/`processing` request already exists | `CONFLICT` |
| `request_withdrawal` amount ≤ 0 or > available balance | `VALIDATION_ERROR` |
| `request_withdrawal` with a blank bank field | `VALIDATION_ERROR` |
| Non-admin calls `process_withdrawal`/`reject_withdrawal`/`mark_withdrawal_paid` | `FORBIDDEN` |
| `process_withdrawal`/`reject_withdrawal` on a non-`pending` request | `CONFLICT` |
| `reject_withdrawal` with a blank reason | `VALIDATION_ERROR` |
| `mark_withdrawal_paid` on a non-`processing` request | `CONFLICT` |
| `mark_withdrawal_paid` with a proof path outside the withdrawal's folder | `VALIDATION_ERROR` |
| Storage upload succeeds but `mark_withdrawal_paid` fails | uploaded object removal attempted (known no-op today, same as Phase 6/7) |

## 7. Testing

- `lib/validations/withdrawal.test.ts` — unit tests for `RequestWithdrawalSchema` (valid input; rejects zero/negative amount; rejects blank bank fields), matching every prior phase's validation-test convention.
- No automated tests for the service layer or the four RPCs (DB-dependent, no test harness in this repo) — verified manually via a **genuinely executed** Playwright walkthrough (per the standing lesson from Phase 5's final verification) covering: requesting within balance, requesting above balance (rejected both client- and server-side), attempting a second request while one is `pending`/`processing` (blocked), Admin "Proses" (pending→processing), Admin "Tolak" from pending (rejected + wallet refund verified via the wallet page), Admin upload-proof-and-mark-paid (processing→paid, proof visible to the worker via signed URL), and non-owner/non-admin access attempts on both `/wallet` and `/admin/withdrawals/[id]`.

## 8. Open assumptions (documented here as the safest MVP default, revisit later)

- **"Prevent duplicate withdrawal"** (Implementation Prompt §21) is read as: at most one `pending` or `processing` withdrawal per user at a time. The PRD/prompt don't define "duplicate" more precisely; this is the literal, simplest reading that also keeps the balance-hold arithmetic in §4.1 straightforward.
- **Reject is only available from `pending`.** Once Admin moves a request to `processing`, the only forward path is `mark_withdrawal_paid`. A failed real-world transfer after that point has no in-app recovery in this phase — confirmed acceptable for MVP.
- **The wallet is debited at request time, not at payout.** This is what makes "available balance" (the PRD §28 rule) and "no duplicate withdrawal" both enforceable with a single balance check, without a separate "reserved" ledger column — a rejected request's amount is refunded via a `refund`-type transaction, never by mutating the original `withdrawal` transaction.
- **No minimum withdrawal amount or cooldown** — the PRD only specifies the maximum (available balance); nothing else is added.
- **Audit action names use the Implementation Prompt's own §31 examples verbatim** (`WITHDRAWAL_PROCESSING`, `WITHDRAWAL_PAID`, `WITHDRAWAL_REJECTED`) rather than inventing new ones, since — unlike `PAYMENT_VERIFIED`/`PAYMENT_REJECTED` in Phase 6, which departed from the prompt's `PAYMENT_APPROVED` example — these three names already match this phase's actual status values one-to-one.
