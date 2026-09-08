# Employer Verification + Minimal Admin Authorization — Design

**Status:** Approved
**Date:** 2026-09-08
**Scope:** Phase 3 of PARUH WAKTU MVP (see `docs/PRD — PARUH WAKTU MVP.md` §7-8, §34, and `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` STEP 4)

## 1. Purpose

Let a worker request to become an employer (submit KTP + identity data), and let an admin review and approve/reject that request. Approval grants the `employer` role, unblocking job creation in a later phase. This is the first phase to introduce any `/admin` surface — scoped to exactly what employer verification needs, not a general admin dashboard (deferred to the phase that needs it, matching the Implementation Prompt's STEP 12 ordering).

## 2. Out of scope (explicitly deferred)

- General admin dashboard, user management, job/payment/withdrawal management, category management, settings UI — each arrives with its own feature phase.
- Any in-app way to grant the `admin` role. The first admin account is provisioned by the human directly via a documented SQL statement run in the Supabase Dashboard SQL Editor (Section 8 below) — never a self-service or automatic path, per the PRD's explicit rule that a normal user must never make themselves admin.
- Automated KYC/OCR/face recognition (explicitly out of scope per PRD §46).

## 3. What already exists (Phase 1), reused as-is

- `public.employer_verifications` table (id, user_id, status, full_name_on_ktp, ktp_number, ktp_document_path, rejection_reason, submitted_at, reviewed_at, reviewed_by, timestamps), with a partial unique index enforcing at most one `pending` row per user.
- `public.user_roles` (user_id, role, granted_at, granted_by), `unique (user_id, role)`.
- `public.audit_logs` (actor_id, action, entity_type, entity_id, description, metadata, created_at).
- `public.is_admin()` — `SECURITY DEFINER`, `set search_path = ''`, checks the caller's own `user_roles` for an `admin` row.
- RLS: `employer_verifications_select_own_or_admin` (SELECT only — no INSERT/UPDATE policy yet).
- Storage: `kyc-documents` bucket (private) already has `kyc_documents_insert_own` (INSERT, owner-folder-scoped) and `kyc_documents_select_own_or_admin` (SELECT, owner or `is_admin()`) policies — no storage-side changes needed for this phase.
- `lib/auth/get-current-user.ts`: `getCurrentUser()`, `requireRole(role)` (throws `appError('UNAUTHENTICATED' | 'FORBIDDEN')`).
- `lib/errors.ts`: `appError`, `toSafeErrorMessage`, `ErrorCode` including `CONFLICT`, `VALIDATION_ERROR`, `NOT_FOUND`.

## 4. Database changes (new migration)

### 4.1 RLS: allow a worker to submit their own request

```sql
create policy "employer_verifications_insert_own"
on public.employer_verifications for insert
to authenticated
with check (
  user_id = (select auth.uid())
);
```

No UPDATE policy is added for regular users or admins — all status transitions happen exclusively through the `review_employer_verification` function below (`SECURITY DEFINER`, bypasses RLS, re-checks admin status internally). This keeps "who can change status" enforced in exactly one place.

### 4.2 Atomic review function

```sql
create or replace function public.review_employer_verification(
  p_verification_id uuid,
  p_decision text, -- 'approved' | 'rejected'
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION_ERROR: invalid decision %', p_decision;
  end if;

  if p_decision = 'rejected'
     and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'VALIDATION_ERROR: rejection_reason required';
  end if;

  select user_id, status into v_user_id, v_status
  from public.employer_verifications
  where id = p_verification_id
  for update;

  if v_user_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'CONFLICT: already reviewed';
  end if;

  update public.employer_verifications
  set status = p_decision,
      reviewed_at = now(),
      reviewed_by = (select auth.uid()),
      rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else null end
  where id = p_verification_id;

  if p_decision = 'approved' then
    insert into public.user_roles (user_id, role, granted_by)
    values (v_user_id, 'employer', (select auth.uid()))
    on conflict (user_id, role) do nothing;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values (
    (select auth.uid()),
    case when p_decision = 'approved' then 'EMPLOYER_APPROVED' else 'EMPLOYER_REJECTED' end,
    'employer_verification',
    p_verification_id,
    case when p_decision = 'rejected' then p_rejection_reason else null end
  );
end;
$$;

revoke execute on function public.review_employer_verification from public, anon;
grant execute on function public.review_employer_verification to authenticated;
```

Key properties: row-locked (`for update`) to prevent a double-approve race between two admins; idempotency guard via the `status <> 'pending'` check; `is_admin()` re-checked inside the function as defense-in-depth (not just trusting the layout guard); single transaction covers status update + role grant + audit log, so there is no reachable state where one happens without the others.

The app-layer error strings thrown by `raise exception` (`'FORBIDDEN'`, `'CONFLICT: ...'`, etc.) are parsed by the calling Server Action and mapped to the matching `AppError` code from `lib/errors.ts`, consistent with how the rest of the codebase surfaces DB errors to users.

## 5. Application layer

### 5.1 Validation (`lib/validations/employer-verification.ts`)

- `fullNameOnKtp`: `z.string().trim().min(2, ...)` (trim-before-validate, per the Phase 2 fix).
- `ktpNumber`: Indonesian NIK, exactly 16 digits — `z.string().trim().regex(/^\d{16}$/, ...)`.
- File: client-side type/size check mirroring `avatar-uploader.tsx`'s existing pattern (allowed types per the `kyc-documents` bucket's Phase 1 config: `image/jpeg`, `image/png`, `application/pdf`; max size 10MB / 10485760 bytes, same bucket config).

### 5.2 Worker-facing: `/verification`

- `app/verification/page.tsx` (Server Component): loads the current user's latest `employer_verifications` row (if any, `order by submitted_at desc limit 1`).
  - No row, or latest is `rejected` → render the request form (rejected case shows the prior status + `rejection_reason` first, with an "Ajukan Lagi" action that reveals the same form for a fresh submission).
  - Latest is `pending` → render a status-only view ("Menunggu peninjauan Admin").
  - Latest is `approved` → render a status-only view ("Anda terverifikasi sebagai Pemberi Kerja").
- `app/verification/actions.ts`: `submitEmployerVerificationAction` — validates via the Zod schema, uploads the file to `kyc-documents/${userId}/${Date.now()}-${file.name}` using the authenticated (non-service-role) client, then inserts the `employer_verifications` row (`user_id`, `full_name_on_ktp`, `ktp_number`, `ktp_document_path`). A unique-violation on the partial index (already-pending row) is caught and re-thrown as `appError('CONFLICT', 'Anda masih memiliki pengajuan yang menunggu peninjauan.')`.
- `app/verification/verification-form.tsx` (Client Component): `useActionState` + native `<form>`, matching the Phase 2 form conventions (no react-hook-form).

### 5.3 Admin-facing: `/admin/employer-verifications`

- `app/admin/layout.tsx` (Server Component): calls `requireRole('admin')`; an `AppError('FORBIDDEN')` is allowed to propagate to a Next.js `not-found`/error boundary (mirrors how other protected areas fail closed).
- `app/admin/employer-verifications/page.tsx`: lists verification requests (default: `pending` first), each row shows applicant name, submission date, status.
- `app/admin/employer-verifications/[id]/page.tsx`: Server Component. Reads the row (own authenticated admin client — the existing `kyc_documents_select_own_or_admin` SELECT policy already permits this), calls `supabase.storage.from('kyc-documents').createSignedUrl(path, 60)` for a 60-second-lived URL to render the KTP image/PDF inline, and renders Approve/Reject actions.
- `app/admin/employer-verifications/actions.ts`: `reviewEmployerVerificationAction(verificationId, decision, rejectionReason?)` — calls `requireRole('admin')` first (defense-in-depth alongside the layout guard and the function's own internal check), then `supabase.rpc('review_employer_verification', {...})`, translates DB exceptions back to `AppError`s, and `revalidatePath`s both the list and detail routes.

## 6. Error handling

Reuses `lib/errors.ts` as-is — no new error codes needed. `CONFLICT` covers "already has a pending request" and "already reviewed" (a second admin clicking Approve on an already-decided row); `VALIDATION_ERROR` covers form/decision validation failures; `FORBIDDEN` covers non-admin access attempts, both at the layout guard and inside the DB function.

Mapping a `raise exception` from `review_employer_verification` back to an `AppError`: the caller inspects the Postgres error message text (accessible on the JS error object returned by `supabase.rpc(...)`) with simple prefix checks — `'FORBIDDEN'` → `appError('FORBIDDEN')`, a message starting with `'CONFLICT:'` → `appError('CONFLICT', ...)`, `'NOT_FOUND'` → `appError('NOT_FOUND')`, a message starting with `'VALIDATION_ERROR:'` → `appError('VALIDATION_ERROR', ...)`; anything else falls through to `toSafeErrorMessage`'s existing `INTERNAL_ERROR` default. This is the same "parse a known prefix, default to internal" shape already used nowhere else in the codebase yet, so the implementer should write it as a small local `if`/`switch` in `reviewEmployerVerificationAction`, not a new shared abstraction (only one call site needs it).

## 7. Testing

- Unit tests for the new Zod schema (`ktpNumber` NIK format, `fullNameOnKtp` trim-then-validate) mirroring the existing `lib/validations/*.test.ts` style.
- Manual end-to-end verification (mirrors Phase 2's Task-8-style DoD check, since RLS/RPC behavior can't be meaningfully unit-tested without a live Supabase connection): submit as a worker → confirm row + partial-unique-index conflict on a second pending submission → admin approves → confirm `user_roles` gained `employer` and `audit_logs` gained `EMPLOYER_APPROVED` → reject path on a fresh account → confirm rejection reason shown and resubmission works.

## 8. Manual step required from the human

Before admin-side testing is possible, the human must provision the first admin account by running this in the Supabase Dashboard SQL Editor (replace the email):

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'REPLACE_WITH_ADMIN_EMAIL'
on conflict (user_id, role) do nothing;
```

## 9. Open assumptions (per PRD §58 — safest MVP default, documented, revisit later)

- Resubmission after rejection creates a brand-new `employer_verifications` row (the old rejected row is kept for history/audit, not overwritten).
- A user can be admin and simultaneously worker/employer (no exclusivity enforced) — matches the PRD's general dual-role model, and nothing in this phase needs to prevent it.
- The 60-second signed URL lifetime for KTP viewing is a judgment call, not a PRD-specified number — short enough to limit exposure if the URL leaks (e.g., via logs/screenshots), long enough for an admin to view one document without needing to reload.
