# Job Application & Assignment — Design

## 1. Purpose

Complete the remainder of the PRD's "Job Marketplace" scope that Phase 4 didn't cover: a worker applies to an open job, an employer reviews applicants and selects one, and that selection assigns the job to a single worker — matching PRD §12 (Job Application), §13 (Assignment), and the Implementation Prompt's STEP 5 bullets "apply / application management / assignment".

Core flow (PRD §52, §12, §13):

```
Job Open → Worker Applies (pending) → Employer Reviews → Accepted / Rejected
                                                ↓ (accepted)
                                    Job → Assigned to Worker
```

## 2. Out of scope (explicitly deferred)

- **Notifications.** The `notifications` table exists in the schema but has no code using it anywhere in the app. PRD §41 calls in-app notifications optional ("jika diperlukan"). Deferred to a later phase — accepting/rejecting an application does not insert a notification row in this phase.
- **Payment / work-in-progress flow.** What happens after `jobs.status = 'assigned'` (waiting_payment onward) is Phase 7+.
- **Location/map picker.** STEP 6, not this phase.
- **Editing an application's message after submission.** Re-applying (after rejection/cancellation) is the only way to change what was said; there is no in-place edit.
- **A worker-side limit on concurrent active applications across different jobs.** Nothing in the PRD restricts a worker to one active job/application at a time; only "one active worker per *job*" is a rule (PRD §45).

## 3. What already exists (Phase 1), reused as-is

All schema for this phase was created in Phase 1's `supabase/migrations/20260907083407_jobs_and_applications.sql` and touched by two later migrations — no new tables, only one new function (§4).

- **`job_applications`**: `id, job_id, worker_id, status ('pending'|'accepted'|'rejected'|'cancelled'), message, applied_at, reviewed_at, created_at, updated_at`. Partial unique index `job_applications_one_active_per_worker_job on (job_id, worker_id) where status in ('pending','accepted')` — already enforces "no second active application on the same job" at the DB level, and already permits re-applying after a rejection/cancellation (the index simply doesn't match those rows). SELECT-only RLS (`job_applications_select_involved_or_admin`: worker, the job's employer, or admin). No INSERT/UPDATE/DELETE policy exists — all writes go through a service-role client, same rule Phase 4 established for `jobs`.
- **`job_assignments`**: `id, job_id, worker_id, status ('active'|'completed'|'cancelled'), assigned_at, created_at, updated_at`. Partial unique index `job_assignments_one_active_per_job on (job_id) where status = 'active'` — makes a second active assignment on the same job impossible at the DB level even under a race. SELECT-only RLS, same shape as above. No write policy.
- **`sync_job_assigned_worker()` trigger** (AFTER INSERT/UPDATE on `job_assignments`) already keeps `jobs.assigned_worker_id` in sync with the active assignment row — this phase does not touch that trigger.
- **`jobs.status`** CHECK constraint already includes `'assigned'` in its enum. `jobs.assigned_worker_id` already exists and is already used by `getJobDetail`'s visibility check (Phase 4) — an assigned worker can already see their job.
- **Employer-verification's "atomic review function" pattern** (Phase 3) is the direct precedent for this phase's `select_job_worker` function (§4).

## 4. Database changes (new migration)

One new `SECURITY DEFINER` Postgres function, callable via `supabase.rpc()`:

```sql
select_job_worker(p_job_id uuid, p_application_id uuid) returns void
```

Inside a single transaction:

1. Lock the job row (`select ... for update`); verify `jobs.employer_id = auth.uid()` and `jobs.status = 'open'` — else raise an exception mapped to `FORBIDDEN`/`CONFLICT` by the caller.
2. Verify the application belongs to `p_job_id` and `status = 'pending'` — else `CONFLICT`.
3. Insert into `job_assignments (job_id, worker_id, status)` values `(p_job_id, <application's worker_id>, 'active')`. The existing partial unique index is the final backstop against a concurrent second active assignment.
4. Update the chosen application to `status = 'accepted', reviewed_at = now()`.
5. Update every other `status = 'pending'` application on `p_job_id` to `status = 'rejected', reviewed_at = now()`.
6. Update `jobs.status = 'assigned'`.

No new RLS policies. `job_applications`/`job_assignments` keep SELECT-only RLS; `apply`, `cancel`, and `reject` are plain service-role writes (§5.2) — the same split Phase 4 used for `jobs` (simple single-row writes as plain writes, only the genuinely multi-effect transition as a database function), and the same reasoning Phase 3 used for its atomic review function.

## 5. Application layer

### 5.1 Validation (`lib/validations/application.ts`)

```ts
ApplyToJobSchema = z.object({
  message: z.string().trim().max(1000, { error: 'Pesan maksimal 1000 karakter.' }).optional(),
})
```

Optional cover message, trimmed before validating (consistent with every prior phase's fix for this ordering). Unit-tested like `lib/validations/job.ts`/`job.test.ts`.

### 5.2 Service layer (`lib/services/applications.ts`)

- `applyToJob(jobId, input: ApplyToJobInput): Promise<{ id: string }>` — `getCurrentUser()`; verify the job exists and `status === 'open'`; verify caller isn't `job.employer_id` (→ `FORBIDDEN`, "cannot apply to own job" per PRD §12); insert via service-role client; translate a unique-index violation into `appError('CONFLICT', 'Anda sudah memiliki lamaran aktif untuk pekerjaan ini.')`.
- `cancelApplication(applicationId): Promise<void>` — verify caller owns the application and its `status === 'pending'` (else `FORBIDDEN`/`CONFLICT`); update to `'cancelled'`.
- `rejectApplication(applicationId): Promise<void>` — verify caller is the employer of the application's job, job `status === 'open'`, application `status === 'pending'`; update to `'rejected'`, `reviewed_at = now()`. Standalone action distinct from `selectWorker`'s reject-the-rest side effect — matches the PRD §12 flow's explicit `Accepted / Rejected` branch.
- `getApplicationsForJob(jobId): Promise<ApplicationWithWorker[]>` — employer-only (verify ownership); returns applicant rows joined with the worker's profile name.
- `getMyApplications(): Promise<ApplicationSummary[]>` — worker-facing; returns the caller's own applications joined with job title/status.
- `getMyApplicationForJob(jobId): Promise<ApplicationSummary | null>` — the caller's most recent application (any status) for one specific job, or `null` if they've never applied. Drives `app/jobs/[id]/page.tsx`'s worker-facing section (§5.3): `null` or a rejected/cancelled result shows the apply form; a pending result shows status + cancel; an accepted result shows status only.
- `selectWorker(jobId, applicationId): Promise<void>` — verify caller is the job's employer (friendly pre-check), then `supabase.rpc('select_job_worker', { p_job_id: jobId, p_application_id: applicationId })`; map the function's raised exceptions to the appropriate `AppError`. The RPC re-validates everything itself — the JS-layer check exists only to fail fast with a clean error message, never as the actual authority (PRD §13: "Never rely only on frontend state").

### 5.3 Routes

- **`app/jobs/[id]/page.tsx`** (existing, Phase 4) — add a worker-facing section, visible when the viewer isn't the job's employer: if `status === 'open'` and no active (pending/accepted) application exists for this viewer, show an apply form (optional message) posting to a new `applyToJobAction`; if a pending application exists, show its status plus a "Batalkan Lamaran" button (`cancelApplicationAction`); if accepted, show that status with no actions; if the most recent application is rejected/cancelled, show the apply form again (re-apply).
- **New `app/jobs/[id]/applicants/page.tsx`** (employer-only, `notFound()` for anyone but the job's owner) — lists applicants (name, message, status, applied date); while `status === 'open'`, each pending row gets "Pilih Pekerja Ini" (`selectWorkerAction`) and "Tolak" (`rejectApplicationAction`) buttons.
- **`app/jobs/[id]/page.tsx`** and **`app/jobs/mine/page.tsx`** (existing) — add a link to `/jobs/[id]/applicants` for the job's owner.
- **New `app/applications/mine/page.tsx`** — worker-facing list of the caller's own applications (job title, status, applied date, link to the job).
- New `app/jobs/[id]/applicants/actions.ts` (or added to the existing `app/jobs/actions.ts`) for `selectWorkerAction`/`rejectApplicationAction`; new `app/applications/actions.ts` for `applyToJobAction`/`cancelApplicationAction`.

## 6. Error handling

All via the existing `appError`/`AppError`/`toSafeErrorMessage` pattern (Phase 1):

| Situation | Error |
|---|---|
| Worker applies to their own job | `FORBIDDEN` |
| Applies to a non-`open` job | `CONFLICT` |
| Applies while an active application already exists on that job | `CONFLICT` (unique-index violation translated to a friendly message) |
| Cancels an application that isn't theirs, or isn't `pending` | `FORBIDDEN` / `CONFLICT` |
| Employer manages applications on a job they don't own | `FORBIDDEN` |
| `selectWorker`/`rejectApplication` on a non-`open` job or non-`pending` application | `CONFLICT` |
| RPC function's own re-validation fails (race lost, job no longer open, etc.) | mapped to `CONFLICT` by the caller |

## 7. Testing

- `lib/validations/application.test.ts` — unit tests for `ApplyToJobSchema` (valid input, trims whitespace, rejects over-length message), mirroring `lib/validations/job.test.ts`.
- No automated tests for the service layer or the RPC function (DB-dependent, no test DB harness exists in this repo) — consistent with every prior phase. Verified manually against a Definition-of-Done checklist covering: apply, duplicate-apply rejection, cancel, re-apply after cancel, employer reject, employer select (including the reject-the-rest side effect and the job status transition to `assigned`), and a non-owner attempting to manage another employer's applicants.

## 8. Open assumptions (per PRD §53 — Product Boundary explicitly defers technical/implementation decisions to specs like this one; documented here as the safest MVP default, revisit later)

- **Accepting one application auto-rejects the job's other pending applications.** The PRD does not specify this; chosen because it matches "one active worker per job" cleanly and avoids stale pending applications sitting on an already-assigned job with no way to resolve them.
- **A standalone `rejectApplication` action exists**, separate from `selectWorker`'s reject-the-rest side effect — inferred from the PRD §12 flow diagram's explicit `Accepted / Rejected` branch, since the PRD text doesn't spell out whether "reject" is ever a direct employer action versus only an automatic consequence of selecting someone else.
- **Re-applying after rejection/cancellation is allowed** (no cap on re-application count) — matches the existing partial unique index's own design comment from Phase 1's migration.
- **No notification is sent** on any status change in this phase (see §2).
- **A worker may hold applications/assignments across multiple different jobs simultaneously** — nothing in the PRD restricts this, only "one active worker per job" is a stated rule.
