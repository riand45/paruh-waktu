# Job Completion & Wallet Crediting — Design

## 1. Purpose

Implement the PRD's "STEP 8 — Work Completion" (evidence upload, worker completion, employer confirmation, job completion) together with the wallet-crediting half of "STEP 9 — Wallet" that the PRD ties to the same atomic confirm action (§20 "Wallet After Completion") — the next unbuilt piece of the core business flow after Phase 6's payment verification. Matches PRD §19-20/§22-26 and the Implementation Prompt's §19-20/STEP 8.

Core flow (PRD §52, §24):

```
Payment Verified → Work In Progress → Worker Upload Evidence →
Worker Submit Completion → Waiting Confirmation → Employer Confirm →
Job Completed → Wallet Transaction
```

## 2. Out of scope (explicitly deferred)

- **Withdrawals** (`withdrawals` table, the `withdrawal-proofs` bucket) — a separate, later phase (PRD §27/§21, STEP 10). Not touched here.
- **Employer reject/rework path on a completion request.** The PRD only describes "Employer confirms" → `Completed`, with no reject/rework step anywhere in §19/§24 (unlike payment verification, which explicitly has one) — confirmed with the user; not building it.
- **Job cancellation.** `jobs.status = 'cancelled'` exists in the CHECK constraint but no phase built so far has any code path that reaches it — out of scope, unreachable today regardless.
- **Full wallet feature set** (available-vs-current-balance distinction, filtering/pagination on transaction history) — "available balance" only ever differs from "current balance" once withdrawals exist to reserve funds, which isn't built yet. This phase's wallet page shows one balance number and the raw transaction list.
- **Admin involvement.** Unlike payment verification, nothing in PRD §19/§24 gives Admin a role in job completion — this flow is strictly employer↔worker.

## 3. What already exists (Phase 1), reused as-is

All schema for this phase was created in Phase 1's `supabase/migrations/20260907083407_jobs_and_applications.sql` and `20260907101332_payments_and_wallet.sql` — no new tables, no new storage buckets, no new RLS policies. Only four new functions (§4).

- **`jobs.status`** CHECK constraint already includes `in_progress`, `waiting_confirmation`, `completed`. Nothing currently writes any of these — the only status writers so far are Phase 5's `select_job_worker` and Phase 6's payment RPCs (which stop at `payment_verified`/`payment_rejected`).
- **`job_evidences`**: `id, job_id, assignment_id, uploaded_by, file_path, file_type, file_size_bytes, created_at`. SELECT-only RLS (`job_evidences_select_involved_or_admin`: employer, assigned worker, or admin) — no write policy on the table row, matching the established "writes go through a SECURITY DEFINER function" rule. A `before insert or update` trigger (`check_job_evidences_consistency`) already enforces `job_evidences.job_id` matches `job_assignments.job_id` for the given `assignment_id`.
- **`job-evidences` storage bucket**: already exists (private, 20MB limit), with a working RLS pair: SELECT for involved/admin, INSERT scoped to the assigned worker via the folder-per-job convention. This phase creates no new bucket or storage RLS.
- **`job_assignments.status`** CHECK constraint already includes `active`/`completed`/`cancelled`. Only `active` is currently written (by `select_job_worker`); this phase is the first to write `completed`.
- **`wallets`**: `id, user_id (unique), balance, created_at, updated_at`. SELECT-only RLS (own row or admin). No row exists for a worker until lazily created.
- **`wallet_transactions`**: `id, wallet_id, type ('job_income'|'platform_fee'|'withdrawal'|'refund'|'adjustment'), amount, balance_after, related_job_id, related_withdrawal_id, description, idempotency_key (unique), created_by, created_at`. SELECT-only RLS (own wallet's rows or admin).
- **`payments`** (Phase 6): the source of truth for the money this phase moves — `amount`, `platform_fee`, `fee_payer`, `status`. This phase reads (never re-derives from live `platform_settings`) the already-verified payment's locked-in numbers.
- **`review_payment`** (Phase 6) is the direct precedent for `confirm_job_completion`'s shape: `SECURITY DEFINER`, row-lock, status-guard, `audit_logs` insert. **`submit_payment_proof`** (Phase 6) is the direct precedent for `record_job_evidence`: file uploaded server-side via the auth-context client, a folder-containment check on the path, then a DB-recording RPC call. **`get_or_create_payment`** (Phase 6) is the direct precedent for `start_work`: idempotent, lazy, triggered by a page view rather than a distinct named user action.

## 4. Database changes (new migration)

Four new `SECURITY DEFINER` functions, all callable via `supabase.rpc()`. All four: `security definer`, `set search_path = ''`, fully-qualified `public.` references, `is distinct from` (never `<>`) for ownership checks against `(select auth.uid())`, `revoke execute ... from public, anon, service_role; grant execute ... to authenticated;`.

### 4.1 `start_work(p_job_id uuid) returns void`

Idempotent lazy-transition, triggered by the assigned worker's first view of the new completion page:

1. Lock the job row; if `jobs.assigned_worker_id is distinct from (select auth.uid())`, raise `FORBIDDEN`.
2. If `jobs.status = 'in_progress'` or any later status, return immediately (idempotent no-op — safe on every page view, same ordering lesson as `get_or_create_payment`: the no-op check runs before any stricter status check).
3. If `jobs.status = 'payment_verified'`, update to `in_progress`.
4. Otherwise (an earlier status), raise `CONFLICT`.

### 4.2 `record_job_evidence(p_job_id uuid, p_file_path text, p_file_type text, p_file_size_bytes bigint) returns uuid`

1. Lock the job row; verify caller is `assigned_worker_id` (`is distinct from`).
2. Verify `jobs.status = 'in_progress'` — else `CONFLICT` (no evidence can be added once completion is submitted; no rework path, per §2).
3. Validate `p_file_path` stays inside the job's own folder (`p_file_path like p_job_id::text || '/%'`) — the file-path-containment check Phase 6's final review added to `submit_payment_proof`, applied here from the start.
4. Resolve the active `job_assignments.id` for this job server-side (never trust an `assignment_id` from the client) and insert into `job_evidences` (`uploaded_by = auth.uid()`).
5. Return the new row's `id`.

### 4.3 `submit_job_completion(p_job_id uuid) returns void`

1. Lock the job row; verify caller is `assigned_worker_id`.
2. Verify `jobs.status = 'in_progress'` — else `CONFLICT`.
3. Verify at least one `job_evidences` row exists for the job — else `VALIDATION_ERROR: at least one evidence file required`.
4. Update `jobs.status = 'waiting_confirmation'`.

### 4.4 `confirm_job_completion(p_job_id uuid) returns void`

1. Lock the job row; verify caller is `jobs.employer_id` (`is distinct from`).
2. Verify `jobs.status = 'waiting_confirmation'` — else `CONFLICT`.
3. Read the job's `payments` row; require `status = 'verified'` — else `CONFLICT` (defense in depth; should always hold true by this point in the state machine, but never trust it implicitly).
4. `insert into wallets (user_id) values (assigned_worker_id) on conflict (user_id) do nothing`, then select the wallet row (lazy creation, same pattern as `get_or_create_payment`).
5. Insert a `wallet_transactions` row: `type = 'job_income'`, `amount = payments.amount`, `related_job_id = p_job_id`, `idempotency_key = 'job_income:' || p_job_id`, `balance_after = wallets.balance + payments.amount`.
6. If `payments.fee_payer <> 'employer'` (i.e. `'worker'` or `'split'` — the latter still falls through to the same math as `'worker'`, matching the already-shipped, already-parked Phase 6 minor finding, not re-litigated here), also insert a second row: `type = 'platform_fee'`, `amount = -payments.platform_fee`, `related_job_id = p_job_id`, `idempotency_key = 'platform_fee:' || p_job_id`, `balance_after` following from the first row's result.
7. Update `wallets.balance` to the final `balance_after`.
8. Update `job_assignments.status = 'completed'` for the active assignment.
9. Update `jobs.status = 'completed'`.
10. Insert one `audit_logs` row (`action = 'JOB_COMPLETED'`, `entity_type = 'job'`).

Steps 4-9 are one transaction (implicit in a single `plpgsql` function body) — if anything fails, nothing commits, matching the Implementation Prompt §20's atomicity requirement.

## 5. Application layer

### 5.1 Validation

No new Zod schema. Every action here is either a plain button click (`start_work`/`submit_job_completion`/`confirm_job_completion` take no free-text/date input) or a file upload validated inline in the Server Action (MIME type/size), mirroring exactly how Phase 6's action already validates its own file upload — a dedicated schema module would have nothing in it.

### 5.2 Service layer (`lib/services/completions.ts`)

- `startWork(jobId): Promise<void>` — calls `start_work` via the auth-context client (never service-role, since the RPC re-derives `auth.uid()`); swallows/maps `CONFLICT` the same defensive way `getPaymentForJob` learned to in Phase 6's final review (an already-later-stage job is not an error).
- `recordJobEvidence(jobId, file): Promise<{ id: string }>` — uploads to the `job-evidences` bucket at `${jobId}/${Date.now()}-${file.name}` via the auth-context client, then calls `record_job_evidence`; on RPC failure, removes the uploaded object (same rollback shape as Phase 6's proof upload — including that rollback's known, already-parked limitation: no DELETE storage policy exists, so the removal call is currently a no-op; not re-litigated here, same deferred status as the `payment-proofs` case).
- `submitJobCompletion(jobId): Promise<void>` — calls `submit_job_completion`.
- `confirmJobCompletion(jobId): Promise<void>` — admin check not needed (this RPC re-derives `employer_id` itself); calls `confirm_job_completion`.
- `getJobEvidences(jobId): Promise<JobEvidence[]>` — plain read via the auth-context client, relying on `job_evidences`' own correct SELECT RLS.

### 5.3 Service layer (`lib/services/wallet.ts`)

- `getWalletForCurrentUser(): Promise<{ balance: number; transactions: WalletTransaction[] }>` — reads the current user's `wallets` row (or `{ balance: 0, transactions: [] }` if none exists yet — lazy creation means most workers have no row until their first completed job) plus its `wallet_transactions`, newest first. Plain reads via the auth-context client, relying on existing SELECT RLS.

### 5.4 Routes

- **New `app/jobs/[id]/completion/page.tsx`** — one shared page for both roles (mirrors how `/jobs/[id]` itself already branches on `isOwner`). `notFound()` unless the viewer is the job's employer or assigned worker. If the viewer is the assigned worker, calls `startWork` on load (the lazy transition) before rendering. Shows the evidence list to both parties; shows the upload form + an "Ajukan Selesai" (submit completion) button to the worker while `in_progress` (button enabled only once ≥1 evidence exists); shows a "Konfirmasi Selesai" button to the employer while `waiting_confirmation`; shows a completed success state once `completed`.
- **`app/jobs/[id]/page.tsx`** (existing) — widen the existing payment-link block to also show a "Lihat Progres Pekerjaan" link once `job.status` is `payment_verified` or later, visible to **both** the employer and the assigned worker (Phase 6's equivalent link was owner-only, since only the employer had anything to do on that page; here the worker is the primary actor on the linked page, so the link must reach them too).
- **New `app/jobs/[id]/completion/actions.ts`** — three Server Actions (`recordJobEvidenceAction`, `submitJobCompletionAction`, `confirmJobCompletionAction`), each re-verifying auth via the service layer, never relying on the page's own gate alone.
- **New `app/jobs/[id]/completion/evidence-upload-form.tsx`** — client component, `useActionState`, same shape as Phase 6's `payment-proof-form.tsx`.
- **New `app/wallet/page.tsx`** — the current user's balance + transaction history. Requires auth only (every account defaults to the worker role per the PRD); renders the zero-balance/empty-history state gracefully.

## 6. Error handling

| Situation | Error |
|---|---|
| Non-assigned-worker calls `start_work` | `FORBIDDEN` |
| `start_work` called on a job before `payment_verified` | `CONFLICT` |
| Non-assigned-worker calls `record_job_evidence` | `FORBIDDEN` |
| Evidence submitted while job isn't `in_progress` | `CONFLICT` |
| Evidence file path outside the job's own folder | `VALIDATION_ERROR` |
| Storage upload succeeds but the RPC fails | uploaded object removal attempted (known no-op today, same as Phase 6) |
| Non-assigned-worker calls `submit_job_completion` | `FORBIDDEN` |
| Completion submitted while job isn't `in_progress` | `CONFLICT` |
| Completion submitted with zero evidence | `VALIDATION_ERROR` |
| Non-employer calls `confirm_job_completion` | `FORBIDDEN` |
| Confirm attempted while job isn't `waiting_confirmation` | `CONFLICT` |
| Confirm attempted without a `verified` payment on record | `CONFLICT` |

## 7. Testing

- No unit tests planned for this phase — nothing here is pure-JS logic worth unit-testing (no Zod schema, no client-side math; the fee/income calculation lives entirely in SQL, reading the payment's already-locked-in numbers), matching the same DB-dependent/no-test-harness convention every phase's service layer and pages have followed so far.
- Verified via `npm run typecheck`, `npx eslint .`, `npx vitest run` (existing 59 tests, no new ones expected), `npm run build`, plus a genuinely-executed Playwright Definition-of-Done walkthrough (not attested to from code review alone, per the lesson from Phase 5's final verification) covering: the lazy `payment_verified → in_progress` transition (including reload-idempotency), zero-evidence submit-completion rejection, evidence upload + successful submit-completion, employer confirm, wallet balance correctness for both a `fee_payer = 'employer'` job and a `fee_payer = 'worker'` job (two separate test jobs), the wallet page showing the right balance/transactions, and non-owner/uninvolved-user 404 checks on `/jobs/[id]/completion`.

## 8. Open assumptions (documented here as the safest MVP default, revisit later)

- **Wallet crediting is bundled into `confirm_job_completion`**, not deferred to a separate phase — chosen because the PRD's §20 describes it as one atomic sequence, and because splitting it would leave a `completed` job with no defined mechanism to later credit its wallet transaction, which the "no duplicate financial transactions" requirement argues against.
- **The `payment_verified → in_progress` transition is lazy**, triggered by the assigned worker's first view of the new completion page — mirroring `get_or_create_payment`'s precedent exactly, since (as Phase 6's own spec noted) nothing in the PRD names a distinct "start work" user action.
- **At least one evidence file is required before submitting completion** — the PRD's permissive wording ("dapat mengupload", may upload) doesn't strictly require this, but the flow diagram's fixed Upload→Submit ordering and giving the employer something concrete to review both argue for it.
- **No employer reject/rework path** — confirmed against the PRD, which only describes a one-way confirm action for this flow (unlike payment verification's explicit reject+resubmit path).
- **`fee_payer = 'split'` continues to fall through to the same math as `'worker'`** — an already-shipped, already-parked minor finding from Phase 6, not addressed by this phase either.
- **A minimal wallet-view page ships in this phase** rather than waiting for the withdrawal phase, specifically so the wallet-crediting side effect this phase introduces is actually visible somewhere in the UI, not just verifiable via direct DB query.
