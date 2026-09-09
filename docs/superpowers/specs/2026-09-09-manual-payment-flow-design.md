# Manual Payment Flow — Design

## 1. Purpose

Implement the PRD's "STEP 7 — Payment" (manual bank-transfer payment, proof upload, Admin verification) — the next unbuilt piece of the core business flow after Phase 5's job application/assignment. Matches PRD §17-21 and §45's payment business rules, and the Implementation Prompt's §15-17/§28.

Core flow (PRD §18):

```
Worker Assigned → Payment Instruction → Transfer to Admin account →
Upload Payment Proof → Admin Review → Approved / Rejected
```

## 2. Out of scope (explicitly deferred)

- **Wallet/ledger funding.** Confirmed via the Implementation Prompt's own structure: `wallet_transactions` (job_income/platform_fee entries) are created on job **completion** (§20 "Wallet After Completion", a STEP 8/9 action), not on payment **verification**. This phase never writes to `wallets`/`wallet_transactions`.
- **Work-completion flow** (evidence upload, worker/employer completion actions — STEP 8). This phase stops at `jobs.status = 'payment_verified'`; nothing in the current specs defines what "starting work" requires, so advancing further would mean guessing at an unbuilt phase's design.
- **Admin settings UI** for editing `platform_fee_percentage`/`platform_fee_payer`/the new bank-account setting this phase adds. These stay seed-only/DB-only, exactly matching how the fee settings have been treated since Phase 1 — no phase has built an admin-settings editor yet.
- **Withdrawals** (`withdrawals` table) — a separate, later phase (STEP 9-adjacent); the `withdrawal-proofs` bucket already seeded in Phase 1 is not touched here.
- **Refund/dispute** (PRD §29, §45) — confirmed to impose no rule on the payment-verification step itself; cleanly out of scope.

## 3. What already exists (Phase 1), reused as-is

All schema for this phase was created in Phase 1's `supabase/migrations/20260907101332_payments_and_wallet.sql` — no new tables, only three new functions (§4).

- **`payments`**: `id, job_id (unique), employer_id, amount, platform_fee, total_amount, fee_payer ('employer'|'worker'|'split'), status ('waiting_payment'|'waiting_verification'|'verified'|'rejected'), transfer_date, rejection_reason, verified_at, verified_by, created_at, updated_at`. SELECT-only RLS (`payments_select_involved_or_admin`: employer, the job's assigned worker, or admin) — no write policy, matching the established "writes go through a SECURITY DEFINER function" rule from Phase 3/5.
- **`payment_proofs`**: `id, payment_id, uploaded_by, file_path, file_size_bytes, created_at`. SELECT-only RLS, same involved-party logic joined through `payments`. No write policy on the table row (the *storage object*'s own RLS is the actual upload gate — see below).
- **`payment-proofs` storage bucket**: already exists (private, 10MB limit, `image/jpeg`/`image/png`/`application/pdf`), with a working RLS pair: SELECT for involved/admin, INSERT scoped to `payments.employer_id = auth.uid()` via the folder-per-payment-id convention (`(storage.foldername(name))[1]` must equal `payments.id::text`). This phase creates no new bucket or storage RLS.
- **`platform_settings`** already seeds `platform_fee_percentage` (`10`) and `platform_fee_payer` (`"employer"`) — read via a private per-key helper pattern already established in `lib/services/jobs.ts`'s `getDefaultJobRadiusKm`.
- **`jobs.status`** CHECK constraint already includes `waiting_payment`, `payment_review`, `payment_verified`, `payment_rejected`. Nothing currently writes any of these — the only status writer beyond `'open'`→`'assigned'` (Phase 5's `select_job_worker`) is this phase.
- **`review_employer_verification`** (Phase 3) is the direct precedent for this phase's `review_payment` function — same `SECURITY DEFINER`/row-lock/`raise exception 'CODE: detail'`/`audit_logs`-insert shape.
- **KTP upload flow** (`lib/services/employer-verifications.ts`'s `submitEmployerVerification`) is the direct precedent for `submitPaymentProof`: a single Server Action receives the file via `FormData`, uploads it server-side via the cookie-based `createClient()` (not service-role), then records the DB row, rolling back the uploaded object if the DB write fails.

## 4. Database changes (new migration)

Three new `SECURITY DEFINER` functions, all callable via `supabase.rpc()`:

### 4.1 `get_or_create_payment(p_job_id uuid) returns uuid`

Idempotent lazy-creation, triggered by the employer's first view of an `assigned` job:

1. Lock the job row (`select ... for update`); verify `jobs.employer_id = auth.uid()` (`is distinct from`, not `<>` — Phase 5's fail-open bug is the reason).
2. If a `payments` row already exists for this job, return its `id` immediately (idempotent short-circuit — this must run *before* the status check below, so calling this function on a job at any later payment stage is always a safe no-op read, never an error).
3. Otherwise, verify `jobs.status = 'assigned'` — else `CONFLICT`.
4. Read `platform_fee_percentage`/`platform_fee_payer` from `platform_settings` (via `value #>> '{}'`, the safe jsonb-scalar-to-text extraction — not a plain `::text` cast, which leaves quotes on JSON strings), falling back to `10`/`'employer'` if either row is missing.
5. Compute `platform_fee = round(jobs.payment_amount * fee_percentage / 100, 2)` and `total_amount = payment_amount + platform_fee` when `fee_payer = 'employer'`, else `total_amount = payment_amount` (per your decision — the worker/split fee split is a Phase 9 wallet-ledger concern, not visible in what the employer transfers here).
6. Insert the `payments` row (`status = 'waiting_payment'`), update `jobs.status = 'waiting_payment'`, return the new `id`.

### 4.2 `submit_payment_proof(p_payment_id uuid, p_file_path text, p_file_size_bytes bigint, p_transfer_date date) returns uuid`

1. Lock the payment row; verify `payments.employer_id = auth.uid()` (`is distinct from`).
2. Verify `payments.status in ('waiting_payment', 'rejected')` — else `CONFLICT` (both the first submission and a resubmission after rejection are allowed, per your decision; nothing else is).
3. Insert the `payment_proofs` row (`uploaded_by = auth.uid()`).
4. Update `payments`: `status = 'waiting_verification'`, `transfer_date = p_transfer_date`, `rejection_reason = null` (clears any prior rejection reason on resubmission).
5. Update `jobs.status = 'payment_review'`.
6. Return the new `payment_proofs.id`.

### 4.3 `review_payment(p_payment_id uuid, p_decision text, p_rejection_reason text default null) returns void`

Byte-for-byte the same shape as `review_employer_verification`:

1. `if not public.is_admin() then raise exception 'FORBIDDEN'`.
2. Validate `p_decision in ('verified', 'rejected')` → `VALIDATION_ERROR` otherwise.
3. Require non-empty `p_rejection_reason` when rejecting → `VALIDATION_ERROR`.
4. Lock the payment row; `NOT_FOUND` if missing; `CONFLICT` if `status <> 'waiting_verification'`.
5. Update `payments`: `status = p_decision`, `verified_at = now()`, `verified_by = auth.uid()`, `rejection_reason` (set or cleared).
6. Update `jobs.status = 'payment_verified'` or `'payment_rejected'` accordingly.
7. Insert one `audit_logs` row (`action = 'PAYMENT_VERIFIED'`/`'PAYMENT_REJECTED'`, `entity_type = 'payment'`).

All three: `security definer`, `set search_path = ''`, fully-qualified `public.` references, `revoke execute ... from public, anon; grant execute ... to authenticated;`.

### 4.4 New `platform_settings` seed row

`admin_bank_account` — a JSON object `{bank_name, account_number, account_holder_name}` with a placeholder value, read-only in this phase's UI (see §2 — no settings editor exists yet for this or the pre-existing fee settings).

## 5. Application layer

### 5.1 Validation (`lib/validations/payment.ts`)

```ts
SubmitPaymentProofSchema = z.object({
  transferDate: z.coerce.date({ error: 'Tanggal transfer tidak valid.' })
    .refine((d) => d.getTime() <= Date.now(), { error: 'Tanggal transfer tidak boleh di masa depan.' }),
})
```

File validation (type/size) happens in the Server Action itself, matching the KTP precedent exactly — not in this Zod schema.

### 5.2 Service layer (`lib/services/payments.ts`)

- `getPaymentForJob(jobId): Promise<PaymentDetail | null>` — if the caller is the job's employer and the job is `assigned` or later, calls `get_or_create_payment` via the auth-context client (`createClient()`, never service-role — same rule as `selectWorker`, since the RPC re-derives `auth.uid()`), then reads the row. If the caller is the assigned worker or admin, just reads the existing row (or `null`) via the auth-context client, relying on `payments`' own correct SELECT RLS — no service-role client needed anywhere in this file for reads.
- `submitPaymentProof(paymentId, file, transferDate): Promise<{ id: string }>` — uploads `file` to the `payment-proofs` bucket at `${paymentId}/${Date.now()}-${file.name}` via the auth-context client, then calls `submit_payment_proof`; on RPC failure, removes the uploaded object (mirroring the KTP rollback).
- `getPendingPayments(): Promise<PendingPaymentSummary[]>` — admin-only (`requireRole('admin')`), lists all payments via the auth-context client (RLS already grants admin full visibility), sorted `waiting_verification` first.
- `getPaymentDetailForAdmin(paymentId): Promise<AdminPaymentDetail | null>` — admin-only, reads the payment plus its proof history (all `payment_proofs` rows, newest first).
- `reviewPayment(paymentId, decision, rejectionReason?): Promise<void>` — calls `review_payment` via the auth-context client (same RPC-client rule).

### 5.3 Routes

- **New `app/jobs/[id]/payment/page.tsx`** — employer-only (`notFound()` otherwise). Shows the bank-transfer instructions (from `platform_settings.admin_bank_account`), the amount to transfer (`payments.total_amount`), current status, and — while `waiting_payment` or `rejected` — an upload form (transfer date + file); shows the rejection reason when rejected; shows a success state once `verified`.
- **`app/jobs/[id]/page.tsx`** (existing) — add a "Lihat Pembayaran" link for the employer, visible once `job.status` is `assigned` or any later payment-stage status (not gated to `open`-only, same reasoning as the applicants link).
- **New `app/admin/payments/page.tsx`** — list of all payments (`waiting_verification` first, mirroring the employer-verifications list convention), showing job title, employer name, total amount, status.
- **New `app/admin/payments/[id]/page.tsx`** + **`review-form.tsx`** + **`actions.ts`** — mirrors the employer-verification admin trio exactly: signed-URL proof viewing (60s expiry, same image/link branching), an approve/reject form with a required rejection reason, the same `{success, message}` action contract via `reviewPaymentAction`.
- **New `app/jobs/payment-actions.ts`** (or added to a per-route `actions.ts`) for `submitPaymentProofAction` (a Server Action taking `FormData` with `transferDate` + `file`, matching the KTP action's validation-then-service-call shape).

## 6. Error handling

| Situation | Error |
|---|---|
| Non-employer calls `get_or_create_payment` | `FORBIDDEN` |
| `get_or_create_payment` called on a job not yet `assigned` (and no payment exists yet) | `CONFLICT` |
| Non-employer (or wrong payment) calls `submit_payment_proof` | `FORBIDDEN` |
| Proof submitted while payment isn't `waiting_payment`/`rejected` | `CONFLICT` |
| Storage upload succeeds but the RPC fails | uploaded object is removed (rollback), error surfaced normally |
| Non-admin calls `review_payment` | `FORBIDDEN` |
| Invalid decision / missing rejection reason | `VALIDATION_ERROR` |
| Reviewing an already-reviewed payment | `CONFLICT` |

## 7. Testing

- `lib/validations/payment.test.ts` — unit tests for `SubmitPaymentProofSchema` (valid date, rejects a future date), mirroring every prior phase's validation-test convention.
- No automated tests for the service layer or the three RPC functions (DB-dependent, no test harness in this repo) — verified manually via a Definition-of-Done checklist covering: lazy payment creation on first view, fee calculation for `fee_payer = 'employer'`, proof upload (including rollback on a simulated RPC failure if feasible to test), Admin approve, Admin reject + resubmit + re-review, and non-owner/non-admin access attempts. **Genuinely executed via Playwright** (not skipped), per the lesson from Phase 5's final verification.

## 8. Open assumptions (per PRD §53 — Product Boundary explicitly defers technical/implementation decisions to specs like this one; documented here as the safest MVP default, revisit later)

- **`fee_payer = 'employer'` means the employer's transfer includes the fee on top** (`total_amount = amount + fee`); for `'worker'`/`'split'`, the employer transfers exactly `amount`, and how the fee is later deducted from the worker's payout is Phase 9's wallet-ledger concern — not represented anywhere in this phase's data or UI.
- **The payment record is created lazily on the employer's first view** of an `assigned` job, not as part of Phase 5's `select_job_worker` transaction — chosen specifically to avoid modifying that already-shipped, already-reviewed RPC.
- **Resubmission after rejection is allowed indefinitely** — no cap on rejection→resubmit cycles, mirroring Phase 5's "no cap on re-apply after rejection" rule.
- **This phase stops at `jobs.status = 'payment_verified'`** — no automatic advance to `in_progress`. The PRD's job-status list shows `payment_verified → in_progress` only as an illustrative "For example:" sequence, not an absolute rule with a defined trigger.
- **The Admin bank-account destination is a new seed-only `platform_settings` value** with a placeholder — no settings-editor UI exists for it (or for the pre-existing fee settings) in any phase built so far; an Admin would need direct DB access to change it until a future phase builds that UI.
- **No wallet/ledger interaction** — confirmed by the Implementation Prompt's own STEP boundary (wallet funding is tied to job completion, STEP 8/9, not payment verification, STEP 7).
