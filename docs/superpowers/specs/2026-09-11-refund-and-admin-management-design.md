# Refund, Admin Dashboard & Admin User Management — Design

## 1. Purpose

Three PRD sections, bundled into one phase because each is small on its own: §29 Refund, §32 Admin Dashboard, §33 Admin User Management. Explicitly deferred from this phase: §35 Admin Job Management, §38 Admin Category Management, §39 Admin Settings, §40 Audit Log (viewing UI), §41 Notifications — all remain unbuilt after this phase.

## 2. Out of scope (explicitly deferred)

- **Worker/employer-initiated cancellation.** The PRD names only "Admin melakukan Process Refund" (§29) — there is no employer/worker-facing "request cancellation" flow in this MVP. Admin is the sole initiator.
- **Partial refunds.** A refund is always the full `payments.amount` for that job's single payment row — the PRD names no partial-refund concept, and `payments.job_id` is unique (one payment per job), so there's nothing to partially apply against.
- **Reversing a completed job.** Refund is only reachable while `payments.status = 'verified'` and the job hasn't reached `'completed'` — once a job completes, the worker's wallet has already been credited (Phase 7), and clawing that back is a materially different, much riskier feature this phase does not attempt.
- **A general Admin Job Management surface (§35).** The refund action lives on the existing `/admin/payments/[id]` page (admin is already there reviewing that job's payment); no new job-list/search page is introduced.
- **Forced session invalidation on suspend.** No token revocation or sign-out call — enforcement is per-request via `getCurrentUser()` (see §6.3's open assumption).
- **A `reason` field on suspend/activate.** PRD §33 lists the actions as bare "Activate user / Suspend user," with no reason/note field like payment or withdrawal rejection have.
- **Real pagination anywhere in this phase.** Matches this codebase's existing convention (no list page paginates yet); the ~50-user MVP target (PRD §47) makes an unpaginated admin user list acceptable.
- **The `notifications` table and Audit Log viewing UI (§40, §41)** — both stay untouched, same as every prior phase has left them.

## 3. What already exists, reused as-is

- **`profiles.account_status`** (`supabase/migrations/20260907082123_profiles_and_roles.sql:23-24`) — `text not null default 'active' check (account_status in ('active', 'suspended'))`. Already in the schema; this phase is the first to read or write it anywhere in application code.
- **Column-level lockout on `profiles.account_status`** (`supabase/migrations/20260907120918_profiles_column_grant_restriction.sql`) — `authenticated` has table-wide SELECT revoked and re-granted only on `(id, full_name, avatar_url, created_at, updated_at)`. `account_status` (and `phone`/`address`/`latitude`/`longitude`) are **not readable by the ordinary auth-context client at all, including by the row's own owner or an admin** — every read of `account_status` in this phase must go through `createServiceClient()`, matching the existing precedent in `lib/services/profiles.ts`'s `getOwnProfile()`.
- **`wallet_transactions.type` already includes `'refund'`** (`supabase/migrations/20260907101332_payments_and_wallet.sql:78-80`) but it is not used by this phase — that value exists only for refunding a rejected *withdrawal* back into a worker's own wallet (`reject_withdrawal`). A job/payment refund has no wallet to credit (employers don't have wallets in this schema — see §6.1), so this phase writes no `wallet_transactions` row.
- **`jobs.status` already includes `'cancelled'`** and **`jobs.cancelled_reason`** already exists as a column (`supabase/migrations/20260907083407_jobs_and_applications.sql:13-21`) — both dead until this phase (confirmed: no RPC or application code sets either today).
- **`job_assignments.status` already includes `'cancelled'`** (`supabase/migrations/20260907083407_jobs_and_applications.sql:63-64`) — also dead until this phase.
- **The `is_admin()` / `SECURITY DEFINER` RPC pattern** (`supabase/migrations/20260907115904_fix_is_admin_security_definer_and_wrapping.sql`, and every RPC since) — every new privileged write in this phase follows it exactly: `language plpgsql`, `security definer`, `set search_path = ''`, `is_admin()` check, row lock via `for update`, `audit_logs` insert, `revoke ... from public, anon, service_role; grant ... to authenticated;`.
- **The two-step admin-action shape from withdrawal processing** (`process_withdrawal` → `mark_withdrawal_paid`, `supabase/migrations/20260910041646_withdrawal_flow.sql` / `20260910055455_fix_withdrawal_precision_and_ordering.sql`) — refund mirrors this exactly: one RPC records the decision, a second records the proof once the manual transfer is done.
- **The `withdrawal-proofs` storage bucket's exact shape** (`supabase/migrations/20260907102700_storage_buckets.sql:140-162`) — private, 10MB, `image/jpeg`/`image/png`/`application/pdf`, folder-scoped to the owning row's id, admin-only INSERT — reused verbatim for a new `refund-proofs` bucket, scoped to `payments.id` instead of `withdrawals.id`.
- **`getPaymentDetailForAdmin` / `app/admin/payments/[id]/page.tsx`** (`lib/services/payments.ts:198+`, shown in full above) — the page this phase extends, not replaces. Its existing `payment.status === 'waiting_verification' && <ReviewForm .../>` gating pattern is mirrored for the new refund forms.
- **Admin list/detail page conventions** (`app/admin/withdrawals/*`, `app/admin/payments/*`) — `requireAdminOr404()` called again at the top of every admin page (defense-in-depth per `lib/auth/get-current-user.ts:47-50`), plain `<ul>`/`<li><Link>` rows, `mx-auto max-w-2xl flex flex-col gap-6 px-4 py-10` container, server-action file colocated as `actions.ts`, a separate `*-form.tsx` client component per form.

## 4. Part A — Refund

### 4.1 Eligibility

A job is refundable exactly when `payments.status = 'verified'` **and** `jobs.status <> 'completed'`. Since `jobs.status` only ever reaches `'completed'` by way of `confirm_job_completion` reading an already-`'verified'` payment (Phase 7), and `payments.status` never changes after verification except by this phase's own RPCs, checking both conditions together is sufficient — no need to enumerate `jobs.status in ('payment_verified', 'in_progress', 'waiting_confirmation')` explicitly.

### 4.2 Database changes (new migration)

**`payments` table:**
```sql
alter table public.payments
  add column refunded_by uuid references public.profiles (id),
  add column refund_transfer_proof_path text,
  add column refunded_at timestamptz;

-- Replace the status CHECK to add 'refund_pending' and 'refunded'.
-- Confirm the actual auto-generated constraint name at implementation
-- time (expected: payments_status_check — this table's status CHECK
-- was declared inline with no explicit name).
alter table public.payments
  drop constraint payments_status_check,
  add constraint payments_status_check check (
    status in (
      'waiting_payment', 'waiting_verification', 'verified', 'rejected',
      'refund_pending', 'refunded'
    )
  );
```

**`cancel_job_and_refund(p_job_id uuid, p_reason text) returns void`:**
1. `FORBIDDEN` unless `is_admin()`.
2. `select id, status into v_payment_id, v_payment_status from public.payments where job_id = p_job_id for update` — `NOT_FOUND: payment` if no row.
3. `CONFLICT: payment not verified` unless `v_payment_status = 'verified'`.
4. `select status into v_job_status from public.jobs where id = p_job_id for update` — `CONFLICT: job already completed` if `v_job_status = 'completed'`.
5. `update public.jobs set status = 'cancelled', cancelled_reason = p_reason where id = p_job_id`.
6. `update public.job_assignments set status = 'cancelled' where job_id = p_job_id and status = 'active'`.
7. `update public.payments set status = 'refund_pending' where id = v_payment_id`.
8. `insert into public.audit_logs (actor_id, action, entity_type, entity_id, description) values ((select auth.uid()), 'JOB_CANCELLED', 'job', p_job_id, p_reason)`.

**`mark_refund_paid(p_payment_id uuid, p_transfer_proof_path text) returns void`:**
1. `FORBIDDEN` unless `is_admin()`.
2. `select status into v_status from public.payments where id = p_payment_id for update` — `NOT_FOUND` if missing.
3. `CONFLICT: refund not pending` unless `v_status = 'refund_pending'`.
4. `p_transfer_proof_path not like p_payment_id::text || '/%'` → `VALIDATION_ERROR: file_path outside payment folder` (mirrors `mark_withdrawal_paid`'s exact guard).
5. `update public.payments set status = 'refunded', refund_transfer_proof_path = p_transfer_proof_path, refunded_by = (select auth.uid()), refunded_at = now() where id = p_payment_id`.
6. `insert into public.audit_logs (...) values ((select auth.uid()), 'REFUND_PAID', 'payment', p_payment_id, null)`.

Both: `revoke execute ... from public, anon, service_role; grant execute ... to authenticated;`.

**Storage:** new `refund-proofs` bucket (private, 10485760, `['image/jpeg', 'image/png', 'application/pdf']`), with `refund_proofs_select_own_or_admin` (readable by the payment's `employer_id` or `is_admin()`, folder-scoped to `payments.id`) and `refund_proofs_insert_admin_only` — both copied verbatim from the `withdrawal-proofs` policies, substituting `public.payments` for `public.withdrawals` and `employer_id` for `user_id`.

### 4.3 Application layer

- **`lib/services/refunds.ts`** (new, auth-context client — no service-role client needed, same as `payments.ts`/`withdrawals.ts`): `cancelJobAndRefund(jobId, reason)` (calls the RPC), `markRefundPaid(paymentId, file)` (uploads to `refund-proofs/<paymentId>/...` then calls the RPC, mirroring `markWithdrawalPaid`'s upload-then-RPC shape in `lib/services/withdrawals.ts`).
- **`getPaymentDetailForAdmin`** (`lib/services/payments.ts`) gains `jobStatus` in its selected/returned fields (needed for the `<> 'completed'` eligibility check) and the new payment columns (`refundedAt`, `refundTransferProofPath`) in its DTO.
- **`app/admin/payments/[id]/page.tsx`**: after the existing `ReviewForm` gate, add:
  - `payment.status === 'verified' && payment.jobStatus !== 'completed'` → render `<CancelRefundForm paymentId jobId>` (required reason textarea + submit — cancels and moves the payment to `refund_pending`).
  - `payment.status === 'refund_pending'` → render `<RefundProofForm paymentId>` (file upload, mirrors `mark-paid-form.tsx`).
  - `payment.status === 'refunded'` → render the refund's proof image/link + `refundedAt` timestamp, read-only (mirrors the existing proof-display block already on this page, reused for the refund proof via a signed URL from the `refund-proofs` bucket).
- **`app/admin/payments/actions.ts`**: `cancelJobAndRefundAction(jobId, reason)`, `markRefundPaidAction(paymentId, prevState, formData)` — same shape as `app/admin/withdrawals/[id]/actions.ts`'s three actions, `revalidatePath` on `/admin/payments`, `/admin/payments/[id]`, and the job's own pages (`/jobs/[id]`, `/jobs/[id]/chat` stay reachable — chat is not closed by cancellation, per §2).
- **Worker/employer-facing job page**: once `jobs.status = 'cancelled'`, `app/jobs/[id]/page.tsx` shows the job as cancelled (reusing whatever "final state" rendering it already has for `'completed'`, extended to also cover `'cancelled'` with `cancelled_reason` shown) — no new page, a small conditional addition to the existing detail page.

## 5. Part B — Admin Dashboard

Single new page, `app/admin/page.tsx` (nothing currently renders at bare `/admin` — only `layout.tsx` exists). One new function, `getAdminDashboardStats()` in a new `lib/services/admin-dashboard.ts`, using the **auth-context client** (not service-role — every count below is already readable by an admin through existing `is_admin()`-inclusive RLS policies, so no new access path is needed):

| Tile | Query |
|---|---|
| Total users | `count(*)` on `profiles` |
| Total workers | `count(*)` on `user_roles where role = 'worker'` |
| Total employers | `count(*)` on `user_roles where role = 'employer'` |
| Active jobs | `count(*)` on `jobs where status not in ('draft', 'completed', 'cancelled', 'payment_rejected')` |
| Completed jobs | `count(*)` on `jobs where status = 'completed'` |
| Pending payment | `count(*)` on `payments where status = 'waiting_verification'` |
| Pending withdrawal | `count(*)` on `withdrawals where status = 'pending'` |

All seven run in parallel (`Promise.all`), each a `head: true, count: 'exact'` query (no rows fetched). The page renders a plain grid of seven stat tiles (label + number) — no charts, no client-side library, matching this app's minimal admin styling.

## 6. Part C — Admin User Management

### 6.1 Why employers can't be refunded through a wallet

Noted here because it shapes both Part A and the dashboard: `wallets` rows are created lazily only for a **worker** at job completion (`confirm_job_completion`, Phase 7) — an employer-only account has no wallet at all in this schema. This confirms Part A's refund is necessarily a `payments`-row state change plus an out-of-band bank transfer, never a `wallet_transactions` entry.

### 6.2 List & detail pages

- **`lib/services/admin-users.ts`** (new, **service-role client** — `account_status` is unreadable any other way, per §3): `getUsersForAdmin({ search?, role?, status? })` — fetches all `profiles` (`id, full_name, account_status, created_at`) and all `user_roles` via the service client, joins them in memory (same two-query-plus-`Map` shape already used in `lib/services/chat.ts`'s `getConversationsForCurrentUser`), and separately fetches emails via `supabase.auth.admin.listUsers({ perPage: 1000 })` for the `search` filter (name **or** email substring match) — one call is enough at the ~50-user MVP scale (PRD §47), no real pagination. `getUserDetailForAdmin(userId)` — single profile + roles + (if an `employer_verifications` row exists) a link to the existing verification review page.
- **`app/admin/users/page.tsx`**: search box + role/status filter (plain GET query params, server component re-fetches — no client-side state), same `<ul>/<li>` list styling as `/admin/withdrawals`.
- **`app/admin/users/[id]/page.tsx`**: profile fields, roles, verification status/link, and an Activate/Suspend button (whichever is the *opposite* of the user's current `account_status`).

### 6.3 Suspend/activate RPCs

Two small `SECURITY DEFINER` RPCs — kept as RPCs rather than plain service-role writes specifically to preserve this codebase's existing convention that every privileged state change is paired with an `audit_logs` row written from inside the same transaction (every existing admin action does this; a bare service-role `.update()` from the DAL would be the first privileged write in this app with no audit trail).

**`suspend_user(p_user_id uuid) returns void`:**
1. `FORBIDDEN` unless `is_admin()`.
2. `FORBIDDEN: cannot suspend own account` if `p_user_id = (select auth.uid())` — the guard from §2 that prevents an admin locking themselves out with nobody able to reverse it.
3. `update public.profiles set account_status = 'suspended' where id = p_user_id` — `NOT_FOUND` if no row updated.
4. `insert into audit_logs (...) values ((select auth.uid()), 'USER_SUSPENDED', 'profile', p_user_id, null)`.

**`activate_user(p_user_id uuid) returns void`:** same shape, no self-guard needed (re-activating is never harmful to the admin themselves), `account_status = 'active'`, audit action `'USER_ACTIVATED'`.

### 6.4 Enforcement — the one shared infrastructure change

`getCurrentUser()` (`lib/auth/get-current-user.ts:14-34`) gains one step: after loading `claims`, query `account_status` for `claims.sub` via `createServiceClient()` (the auth-context client cannot read this column at all, per §3). If `'suspended'`, return `null` — exactly as if the user had no session. Every existing caller (`requireRole`, `requireAdminOr404`, and every page that checks `if (!user)`) already treats a `null` result as "not logged in," so this single change enforces full lockout everywhere at once, with no new middleware file and no per-page changes.

**Open assumption, carried from brainstorming:** no forced sign-out or token revocation happens on suspend — enforcement is purely "the next call to `getCurrentUser()` returns `null`." A tab a suspended user already has open only gets blocked on its next server round-trip (page navigation or Server Action), the same latency every other role/permission check in this app already has. Acceptable given this app has no real-time push-based auth invalidation anywhere today.

## 7. Error handling

| Situation | Error |
|---|---|
| Non-admin calls `cancel_job_and_refund` / `mark_refund_paid` / `suspend_user` / `activate_user` | `FORBIDDEN` |
| `cancel_job_and_refund` on a job with no payment row | `NOT_FOUND: payment` |
| `cancel_job_and_refund` when `payments.status <> 'verified'` | `CONFLICT: payment not verified` |
| `cancel_job_and_refund` when `jobs.status = 'completed'` | `CONFLICT: job already completed` |
| `mark_refund_paid` on a payment not in `'refund_pending'` | `CONFLICT: refund not pending` |
| `mark_refund_paid` with a proof path outside the payment's own folder | `VALIDATION_ERROR: file_path outside payment folder` |
| `suspend_user(self)` | `FORBIDDEN: cannot suspend own account` |
| `suspend_user`/`activate_user` on a nonexistent user id | `NOT_FOUND` |
| A suspended user makes any request that calls `getCurrentUser()` | treated as logged out — same redirect/404 behavior as an unauthenticated visitor |
| Admin visits `/admin` (dashboard) | always 200 (defense-in-depth `requireAdminOr404()` still applies) |

## 8. Testing

- No new Zod schema — `CancelRefundForm`'s reason field and `RefundProofForm`'s file input reuse existing validation shapes (`markWithdrawalPaidAction`'s file-type/size checks, copied verbatim for the refund proof; the cancellation reason is a plain required non-empty string, not a shared schema, matching `rejectWithdrawalAction`'s inline reason handling — no schema file exists for that one either).
- No automated tests for the RPCs or `getCurrentUser()`'s new suspension check (DB-dependent, no test harness in this repo, same as every prior phase) — verified via a genuinely-executed walkthrough (Playwright where a UI flow is involved, direct DB/RPC calls otherwise) covering: the full cancel → refund_pending → upload proof → refunded sequence on a real job with a verified payment; a `CONFLICT` when attempting to cancel a job whose payment isn't `'verified'` or that's already `'completed'`; the dashboard's seven counts matching a hand-checked query against seeded data; suspending a user and confirming their next authenticated request is treated as logged out; the self-suspend guard; and an admin activating a suspended user back to normal access.

## 9. Open assumptions

- **Refund eligibility is `payments.status = 'verified' AND jobs.status <> 'completed'`**, not an explicit job-status allowlist — see §4.1 for why these are equivalent in this schema today.
- **No `wallet_transactions` row for a job refund** — see §6.1; the `payments` row itself (reason on `jobs.cancelled_reason`, proof + timestamp on `payments`) is the "recorded transaction" the PRD asks for.
- **Suspend/activate carry no reason field** — PRD §33 doesn't ask for one, unlike payment/withdrawal rejection.
- **No forced session invalidation on suspend** — see §6.4.
- **The admin user list has no real pagination** — a single unpaginated fetch, matching every other admin list page in this app, acceptable at the ~50-user MVP target.
