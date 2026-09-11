# Admin Job Management, Category Management, Settings & Audit Log — Design

## 1. Purpose

Four PRD sections, bundled into one phase because each is small on its own: §35 Admin Job Management, §38 Admin Category Management, §39 Admin Settings, §40 Audit Log (viewing). Together with Phase 10 (Refund, Dashboard, User Management), this closes out every admin-facing PRD section except §41 Notifications, which stays deliberately untouched (PRD §41: "MVP tidak menggunakan push notification" — no mechanism named as required).

## 2. Out of scope (explicitly deferred)

- **A separate Job cancellation UI on `/admin/payments/[id]`.** That page's existing "Cancel & Refund" flow (Phase 10) is untouched — it remains the only path for a job whose payment is `verified`. This phase's new `/admin/jobs/[id]` page is a second entry point to the *same* refund RPC for that case, plus a *new* RPC for every other case.
- **Real pagination anywhere.** Matches every existing list page in this app (jobs, withdrawals, users) — full fetch, no `LIMIT`/cursor.
- **Filtering the audit log** (by action, entity type, date range, actor). Per the brainstorming decision: a plain list for this first version, matching `/admin/withdrawals`'s shape.
- **Arbitrary key/value editing in Admin Settings.** The settings page renders exactly the 6 keys named in §4 below — not a generic `platform_settings` table editor. A new key added later needs its own field, not a schema-less input.
- **Retroactively enforcing a job's category-active state.** Deactivating a category doesn't touch jobs that already reference it — both the existing SELECT policy (`is_active = true or is_admin()`) and `assertActiveCategory`'s new-job-only check already establish this precedent; this phase doesn't add anything new here.
- **Blocking payment submission/review on an already-`cancelled` job.** A job cancelled via the new `cancel_job` RPC (§3.2) while its payment is still `waiting_payment`/`waiting_verification`/`rejected` could theoretically still have its payment proof submitted or reviewed afterward — this is a pre-existing gap in the payment flow's own state checks (not introduced by this phase, and `cancel_job`'s own idempotency is unaffected by it), out of scope here.

## 3. Part A — Admin Job Management

### 3.1 Eligibility split

A job is cancellable by admin whenever `jobs.status not in ('cancelled', 'completed')`. Which of the two cancellation RPCs applies depends on whether it has a `verified` payment:

- **Has a `payments` row with `status = 'verified'`** → the existing `cancel_job_and_refund(p_job_id, p_reason)` (Phase 10, unchanged in behavior, hardened per §3.3).
- **Does not** (no `payments` row yet, or one that's `waiting_payment`/`waiting_verification`/`rejected`/`refund_pending`/`refunded`) → the new `cancel_job(p_job_id, p_reason)` (§3.2).

The admin detail page computes which applies and renders a single "Batalkan Pekerjaan" action either way — the reason field and submit button look identical regardless of which RPC ends up firing.

### 3.2 New RPC: `cancel_job(p_job_id uuid, p_reason text) returns void`

1. `FORBIDDEN` unless `is_admin()`.
2. `select status into v_job_status from public.jobs where id = p_job_id for update` — `NOT_FOUND` if missing.
3. `CONFLICT: job already cancelled or completed` if `v_job_status in ('cancelled', 'completed')`.
4. `CONFLICT: use cancel_job_and_refund` if a `payments` row exists for this job with `status = 'verified'` — a defense-in-depth guard against calling the wrong RPC directly (the UI never does this, but the RPC shouldn't trust that), mirroring this codebase's existing pattern of re-checking state server-side rather than trusting client-side branching.
5. `update public.jobs set status = 'cancelled', cancelled_reason = p_reason where id = p_job_id`.
6. `update public.job_assignments set status = 'cancelled' where job_id = p_job_id and status = 'active'`.
7. `insert into public.audit_logs (actor_id, action, entity_type, entity_id, description) values ((select auth.uid()), 'JOB_CANCELLED', 'job', p_job_id, p_reason)` — same action name Phase 10's `cancel_job_and_refund` already uses; both RPCs cancel the same entity type for the same reason, so one shared action string in the audit log is correct, not a collision.

Same shape as every RPC in this codebase: `security definer`, `set search_path = ''`, `revoke ... from public, anon, service_role; grant ... to authenticated;`.

### 3.3 Hardening fix to `cancel_job_and_refund`

Phase 10's final review flagged (as a deferred Minor, now worth closing while this migration is already touching adjacent code): the existing RPC has no guard against being called again on a job that's already `cancelled`. Add one more check, in the same position as the `'job already completed'` check:

```sql
if v_job_status in ('cancelled', 'completed') then
  raise exception 'CONFLICT: job already cancelled or completed';
end if;
```

(Replacing the narrower existing `if v_job_status = 'completed' then ... end if;` — same exception message shape as `cancel_job`'s own check, for a consistent error string across both RPCs.)

### 3.4 Application layer

- **`lib/services/admin-jobs.ts`** (new): `getJobsForAdmin({ search?, status?, categoryId? })` — fetches all `jobs`, batch-joins `employer_id`/`assigned_worker_id` → `profiles.full_name` (two-query-plus-`Map`, same shape as `getUsersForAdmin`/`getWithdrawalsForAdmin`) and `category_id` → `job_categories.name`; filters in-memory after the fetch (search on title, exact match on status/category), matching `getUsersForAdmin`'s existing in-memory-filter precedent. `getJobDetailForAdmin(jobId)` — reuses `getJobDetail(jobId)` (already admin-visible for any job, per its existing `hasRole(..., 'admin')` branch) then joins employer/worker names and, if a `payments` row exists, its `status`. `cancelJob(jobId, reason)` — calls `cancel_job`.
- **`app/admin/jobs/page.tsx`** (new) + **`app/admin/jobs/job-filters.tsx`** (new, client) — GET-query-param search/filter, same shape as `/admin/users`.
- **`app/admin/jobs/[id]/page.tsx`** (new) — job info, employer/worker names, payment status (if any), and the single cancel action (§3.1) rendered via one shared form component that the page binds to whichever action fits.
- **`app/admin/jobs/[id]/cancel-job-form.tsx`** (new, client) — same required-reason-textbox-then-`useTransition` shape as `CancelRefundForm` (Phase 10), parameterized by which Server Action to call.
- **`app/admin/jobs/actions.ts`** (new) — `cancelJobAction(jobId, reason)` (calls the new `cancelJob` service function) and `cancelJobAndRefundAction(jobId, reason)` (calls Phase 10's existing `cancelJobAndRefund` from `lib/services/refunds.ts` directly — the *service* function, not `app/admin/payments/actions.ts`'s own action wrapper, since Server Actions are cheap to re-wrap per route and this keeps `/admin/jobs`'s own `revalidatePath` calls — `/admin/jobs`, `/admin/jobs/[id]` — independent of `/admin/payments`'s).

## 4. Part B — Admin Category Management

### 4.1 New RPCs

**`create_job_category(p_name text) returns uuid`:**
1. `FORBIDDEN` unless `is_admin()`.
2. `insert into public.job_categories (name) values (p_name) returning id into v_id` — a duplicate `name` raises Postgres's own unique-violation (`23505`), mapped to `CONFLICT: category name already exists` at the application layer (matching this codebase's established convention of mapping raw Postgres error codes only where no existing RPC-raised `CONFLICT` message already covers it — see §6, Error handling).
3. `insert into audit_logs (...) values (..., 'CATEGORY_CREATED', 'job_category', v_id, p_name)`.
4. `return v_id`.

**`update_job_category(p_id uuid, p_name text) returns void`:**
1. `FORBIDDEN` unless `is_admin()`.
2. `update public.job_categories set name = p_name, updated_at = now() where id = p_id` — `NOT_FOUND` if no row updated; a duplicate name still raises the same unique-violation as above.
3. `insert into audit_logs (...) values (..., 'CATEGORY_UPDATED', 'job_category', p_id, p_name)`.

**`set_job_category_active(p_id uuid, p_is_active boolean) returns void`:**
1. `FORBIDDEN` unless `is_admin()`.
2. `update public.job_categories set is_active = p_is_active, updated_at = now() where id = p_id` — `NOT_FOUND` if no row updated.
3. `insert into audit_logs (...) values (..., case when p_is_active then 'CATEGORY_ACTIVATED' else 'CATEGORY_DEACTIVATED' end, 'job_category', p_id, null)`.

All three: same `security definer`/`set search_path = ''`/`revoke`+`grant` shape.

### 4.2 Application layer

- **`lib/services/job-categories.ts`** (modify — existing file, currently only `getActiveJobCategories()`): add `getAllJobCategoriesForAdmin()` (no `is_active` filter, admin-only, for the list page), `createJobCategory(name)`, `updateJobCategory(id, name)`, `setJobCategoryActive(id, isActive)`. `getActiveJobCategories()` itself is untouched — same signature, same `{id, name}[]` shape, same `is_active = true` filter — since `app/jobs/page.tsx` and `lib/services/jobs.ts`'s `assertActiveCategory` both depend on it verbatim.
- **`app/admin/categories/page.tsx`** (new) — plain list (name, active/inactive badge, toggle button, edit link) — no search/filter, matching this section's small scale (a handful of categories, per the seed data).
- **`app/admin/categories/[id]/page.tsx`** (new) — a rename form.
- **`app/admin/categories/new/page.tsx`** (new) — a create form (same shape, no `[id]`).
- **`app/admin/categories/actions.ts`** (new) — `createCategoryAction`, `updateCategoryAction`, `toggleCategoryActiveAction`.

## 5. Part C — Admin Settings

### 5.1 New RPC: `update_platform_setting(p_key text, p_value jsonb) returns void`

1. `FORBIDDEN` unless `is_admin()`.
2. `update public.platform_settings set value = p_value, updated_at = now(), updated_by = (select auth.uid()) where key = p_key` — `NOT_FOUND` if no row updated (every key this phase writes already exists via the Phase 1 seed, so this only fires on a typo'd key, never in normal use).
3. `insert into audit_logs (actor_id, action, entity_type, entity_id, description) values ((select auth.uid()), 'PLATFORM_SETTING_UPDATED', 'platform_setting', null, p_key)` — `entity_id` is `null` (the column is `uuid`, `platform_settings.key` is `text`, so there's nothing to put there); `p_key` in `description` is how a viewer knows which setting changed.

No new RLS policy is needed on `platform_settings` itself for this — the RPC is `security definer` and bypasses RLS internally, the same way every other privileged write in this codebase does.

### 5.2 Validation (`lib/validations/platform-settings.ts`, new)

One Zod schema per field, composed into a single form schema:

```ts
export const PlatformSettingsSchema = z.object({
  platformFeePercentage: z.coerce.number().min(0).max(100),
  platformFeePayer: z.enum(['employer', 'worker', 'split']),
  defaultJobRadiusKm: z.coerce.number().positive(),
  maxUploadSizeMb: z.coerce.number().positive(),
  allowedFileTypes: z.string().transform((s) => s.split(',').map((t) => t.trim()).filter(Boolean)),
  bankName: z.string().trim().min(1),
  bankAccountNumber: z.string().trim().min(1),
  bankAccountHolderName: z.string().trim().min(1),
})
```

(`platformFeePayer`'s three values match `payments.fee_payer`'s existing CHECK constraint exactly — no new enum invented.)

### 5.3 Application layer

- **`lib/services/admin-settings.ts`** (new): `getAllPlatformSettings()` — reads all 6 rows (service-role or auth-context client; admin already has SELECT via the existing `platform_settings_select_authenticated` policy, so the auth-context client suffices), shaped into one flat object matching the Zod schema above. `updatePlatformSettings(validated)` — calls `update_platform_setting` once per key (six RPC calls in one Server Action, not six round trips from the browser).
- **`app/admin/settings/page.tsx`** (new) — one form, grouped visually into Payment / Job / Upload sections, pre-filled from `getAllPlatformSettings()`.
- **`app/admin/settings/actions.ts`** (new) — one Server Action parsing `FormData` through `PlatformSettingsSchema`, then `updatePlatformSettings`.

## 6. Part D — Audit Log Viewing

- **`lib/services/audit-logs.ts`** (new): `getAuditLogsForAdmin()` — fetches every `audit_logs` row ordered by `created_at desc`, batch-joins `actor_id` → `profiles.full_name` (fetch-then-`Map`, same shape as `getWithdrawalsForAdmin`). Returns `{ id, actorName, action, entityType, entityId, description, createdAt }[]`.
- **`app/admin/audit-logs/page.tsx`** (new) — plain `<ul>` list (admin name, action, entity type + id, description, timestamp), no search/filter, no detail page (nothing to drill into beyond what's already shown per row).

## 7. Error handling

| Situation | Error |
|---|---|
| Non-admin calls any new RPC | `FORBIDDEN` |
| `cancel_job` on a job already `cancelled`/`completed` | `CONFLICT: job already cancelled or completed` |
| `cancel_job` on a job with a `verified` payment | `CONFLICT: use cancel_job_and_refund` |
| `cancel_job_and_refund` on a job already `cancelled`/`completed` | `CONFLICT: job already cancelled or completed` (widened per §3.3) |
| `create_job_category`/`update_job_category` with a duplicate name | Postgres `23505` → mapped to `CONFLICT: category name already exists` |
| `update_job_category`/`set_job_category_active` on a nonexistent id | `NOT_FOUND` |
| `update_platform_setting` with a key that doesn't exist | `NOT_FOUND` |
| Any Admin Settings field failing its Zod rule | Client-side validation error, same field-level pattern as every other form in this app |

## 8. Testing

- `lib/validations/platform-settings.test.ts` — unit tests for `PlatformSettingsSchema` (valid input; rejects `platformFeePercentage` outside 0-100; rejects an invalid `platformFeePayer`; rejects non-positive `defaultJobRadiusKm`/`maxUploadSizeMb`; `allowedFileTypes` correctly splits/trims/drops-empty on a comma-separated string) — matches every prior phase's validation-test convention.
- No automated tests for any RPC or the service-layer read/join functions (DB-dependent, no test harness in this repo, same as every prior phase) — verified via a genuinely-executed walkthrough covering: `cancel_job` on a no-payment job (and the `CONFLICT` when attempted on an already-cancelled one, and when attempted on a verified-payment job); `cancel_job_and_refund` still works for the verified-payment case and now also rejects a second call on an already-cancelled job; category create/rename/activate/deactivate, including the duplicate-name `CONFLICT`; every Admin Settings field round-tripping through the form into `platform_settings` and back out (including `admin_bank_account` actually becoming configured for the first time); the audit log page showing entries from this phase's own actions alongside the ones already written by every prior phase.

## 9. Open assumptions

- **`cancel_job`'s payment-verified guard is defense-in-depth, not the primary gate** — the admin UI itself decides which RPC to call based on the job's state (§3.1); the RPC's own check exists so a direct API call can't bypass the refund requirement.
- **One shared `JOB_CANCELLED` audit action for both cancellation RPCs** — they cancel the same entity type (a job) for the same reason (admin-initiated cancellation); a viewer doesn't need to distinguish "cancelled with a refund" from "cancelled with no payment yet" by action name alone, since the entity's own state (and, for the refund case, the linked payment's own `REFUND_PAID`/`refund_pending` trail) already carries that distinction.
- **Admin Settings is one page, one submit, six RPC calls** — not six separate mini-forms each with their own submit button, since the PRD frames this as one configuration surface ("Admin dapat mengatur konfigurasi platform").
- **No new detail page for a single audit log entry** — every field the PRD asks for (§40: Admin, Action, Entity, Description, Timestamp) already fits on one list row.
