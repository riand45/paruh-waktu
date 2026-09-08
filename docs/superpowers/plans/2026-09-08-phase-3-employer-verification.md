# Phase 3 — Employer Verification & Minimal Admin Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a worker request to become an employer (submit KTP data + document), and let an admin review and approve/reject that request — the first `/admin` surface in this codebase, scoped to exactly this review queue. Approval grants the `employer` role atomically alongside the status change and an audit log entry.

**Architecture:** Unlike Phase 2's profile DAL, this feature needs **no service-role client at all** for the worker-facing submission path — `employer_verifications` gets a new owner-scoped `INSERT` policy, and the `kyc-documents` storage bucket's owner-scoped `INSERT`/`SELECT` policies already exist from Phase 1, so the regular session-scoped authenticated client (`lib/supabase/server.ts`) is sufficient throughout. The one place that needs elevated, carefully-scoped privilege is the admin review decision: because it must atomically change `employer_verifications.status`, grant the `employer` role in `user_roles`, and write an `audit_logs` row — three related tables in one business transaction — that logic lives in a single `SECURITY DEFINER` Postgres function (`review_employer_verification`), not in application code, so partial failure is impossible by construction. The function re-checks `is_admin()` internally as defense-in-depth, independent of the app-layer `requireRole('admin')` check in both the `/admin` layout guard and the Server Action that calls it.

**Tech Stack:** Next.js 16 (Server Actions, `useActionState`, native `<form>`), Zod v4, Supabase (Postgres function via `SECURITY DEFINER`, Storage signed URLs for the private `kyc-documents` bucket), Supabase CLI (`npx supabase db push`, already linked in Phase 1 — see Task 2's re-link step), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-employer-verification-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §7-8, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` STEP 4, and this repo's Phase 1 (`docs/superpowers/plans/2026-09-07-phase-1-foundation-database.md`) / Phase 2 (`docs/superpowers/plans/2026-09-07-phase-2-auth-profile.md`) plans for the schema and conventions this phase builds on.

## Global Constraints

- Every Server Action re-verifies authentication/authorization inside itself — never rely on `proxy.ts`'s redirect or the `/admin` layout guard alone (established in Phase 1/2, still applies).
- The worker-facing submission path (validate → upload to `kyc-documents` → insert `employer_verifications` row) uses the **regular authenticated client** (`lib/supabase/server.ts`'s `createClient()`), never the service-role client — Phase 1's existing storage RLS and this phase's new table RLS are sufficient; reaching for `createServiceClient()` here would be an unjustified escalation of privilege.
- All status transitions on `employer_verifications` (approve/reject) happen **exclusively** through the `review_employer_verification` Postgres function — no `UPDATE` RLS policy is ever added for this table. This keeps "who can change status, and how" enforced in exactly one place.
- `review_employer_verification` must re-check `public.is_admin()` inside itself and must lock the target row (`for update`) before checking its current status, so two admins cannot both act on the same pending request.
- Zod schemas trim before validating (per Phase 2's fix: `.trim()` must run before `.min()`/regex, not after).
- File uploads (KTP documents) validate file type and size **client-side for UX** and rely on the `kyc-documents` bucket's own `file_size_limit` (10MB / 10485760 bytes) and `allowed_mime_types` (`image/jpeg`, `image/png`, `application/pdf`) — set in Phase 1 — as the real enforcement boundary; never trust the client-side check alone.
- There is no in-app way to grant the `admin` role, by design (PRD: a normal user must never make themselves admin). Task 7 documents the one-off SQL the human runs directly in the Supabase Dashboard to provision the first admin account.
- Routes live at `/verification` and `/admin/employer-verifications`, not inside a parenthesized route group — consistent with Phase 2's `/auth/*` and `/profile` placement.

---

### Task 1: Validation schema (Zod) for the employer verification form

**Files:**
- Create: `lib/validations/employer-verification.ts`
- Create: `lib/validations/employer-verification.test.ts`

**Interfaces:**
- Produces: `SubmitEmployerVerificationSchema`, `SubmitEmployerVerificationFormState` — consumed by Task 3 (service layer) and Task 4 (Server Action + form).

- [ ] **Step 1: Write the failing tests**

Create `lib/validations/employer-verification.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { SubmitEmployerVerificationSchema } from './employer-verification'

describe('SubmitEmployerVerificationSchema', () => {
  const valid = {
    fullNameOnKtp: 'Budi Santoso',
    ktpNumber: '3171234567890001',
  }

  it('accepts valid input', () => {
    expect(SubmitEmployerVerificationSchema.safeParse(valid).success).toBe(true)
  })

  it('trims whitespace before validating the name', () => {
    const result = SubmitEmployerVerificationSchema.safeParse({
      ...valid,
      fullNameOnKtp: '  Budi Santoso  ',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.fullNameOnKtp).toBe('Budi Santoso')
    }
  })

  it('rejects a name shorter than 2 characters after trimming', () => {
    const result = SubmitEmployerVerificationSchema.safeParse({
      ...valid,
      fullNameOnKtp: '  a  ',
    })
    expect(result.success).toBe(false)
  })

  it('rejects a KTP number that is not exactly 16 digits', () => {
    expect(
      SubmitEmployerVerificationSchema.safeParse({ ...valid, ktpNumber: '12345' }).success
    ).toBe(false)
  })

  it('rejects a KTP number containing non-digit characters', () => {
    expect(
      SubmitEmployerVerificationSchema.safeParse({
        ...valid,
        ktpNumber: '317123456789000a',
      }).success
    ).toBe(false)
  })

  it('rejects a whitespace-only KTP number', () => {
    expect(
      SubmitEmployerVerificationSchema.safeParse({
        ...valid,
        ktpNumber: '                ',
      }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/validations/employer-verification.test.ts
```

Expected: FAIL — `Cannot find module './employer-verification'`.

- [ ] **Step 3: Implement the schema**

Create `lib/validations/employer-verification.ts`:

```ts
import { z } from 'zod'

export const SubmitEmployerVerificationSchema = z.object({
  fullNameOnKtp: z
    .string()
    .trim()
    .min(2, { error: 'Nama sesuai KTP minimal 2 karakter.' }),
  ktpNumber: z
    .string()
    .trim()
    .regex(/^\d{16}$/, { error: 'Nomor KTP harus 16 digit angka.' }),
})

export type SubmitEmployerVerificationFormState =
  | {
      errors?: {
        fullNameOnKtp?: string[]
        ktpNumber?: string[]
        file?: string[]
      }
      message?: string
    }
  | undefined
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/employer-verification.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validations
git commit -m "feat: add Zod validation schema for employer verification"
```

---

### Task 2: Database migration — employer verification RLS + atomic review function

**Files:**
- Create: `supabase/migrations/<timestamp>_employer_verification_workflow.sql`

**Interfaces:**
- Produces: RLS policy `employer_verifications_insert_own`; Postgres function `public.review_employer_verification(p_verification_id uuid, p_decision text, p_rejection_reason text default null) returns void` — consumed by Task 6's admin review Server Action.
- Consumes: `public.is_admin()`, `public.employer_verifications`, `public.user_roles`, `public.audit_logs` (all Phase 1).

- [ ] **Step 1: Re-establish the Supabase CLI link**

The CLI's link state (`supabase/.temp/`) is git-ignored and does not survive between worktrees/sessions — `supabase/config.toml` (tracked, holds `project_id`) is already there, but the link must be re-established here:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

(Get a token from https://supabase.com/dashboard/account/tokens if the one from Phase 1 is no longer available. `link` will prompt for the database password — Dashboard → Project Settings → Database → Connection string, or reset it there if unknown.)

- [ ] **Step 2: Verify the link**

```bash
npx supabase migration list
```

Expected: lists all of Phase 1's and Phase 2's migrations as applied on both `Local` and `Remote` — confirms the CLI can reach the project and its migration history matches what's in `supabase/migrations/` on disk. If any migration is missing from `Remote`, stop and resolve that discrepancy before continuing (do not push on top of an inconsistent history).

- [ ] **Step 3: Create the migration file**

```bash
npx supabase migration new employer_verification_workflow
```

Note the generated filename (e.g. `supabase/migrations/20260908090500_employer_verification_workflow.sql`) — edit that exact file in the next step.

- [ ] **Step 4: Write the migration**

Replace the file's contents with:

```sql
-- A worker may submit their own employer-verification request. All status
-- transitions happen exclusively through review_employer_verification()
-- below — there is deliberately no UPDATE policy for any role.
create policy "employer_verifications_insert_own"
on public.employer_verifications for insert
to authenticated
with check (
  user_id = (select auth.uid())
);

-- Atomically approve/reject a pending employer verification: updates the
-- request's status, grants the "employer" role on approval, and always
-- records an audit log entry — all in one transaction, so there is no
-- reachable state where one happens without the others.
create or replace function public.review_employer_verification(
  p_verification_id uuid,
  p_decision text,
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

- [ ] **Step 5: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`.

- [ ] **Step 6: Verify**

```bash
npx supabase migration list
```

Expected: the new `employer_verification_workflow` migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 7: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: the file updates (diff should show `review_employer_verification` appear under `Functions` and the new column/policy shape reflected for `employer_verifications` — the table's columns themselves don't change, only its available operations).

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Tasks 3 and 6).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add employer verification insert policy and review function"
```

---

### Task 3: Employer verification service layer

**Files:**
- Create: `lib/services/employer-verifications.ts`

**Interfaces:**
- Produces: `EmployerVerificationStatus` (interface), `getLatestEmployerVerification()`, `SubmitEmployerVerificationInput` (interface), `submitEmployerVerification(input)` — consumed by Task 4 (worker page + Server Action).
- Consumes: `getCurrentUser` (Phase 1's `lib/auth/get-current-user.ts`), `createClient` (Phase 1's `lib/supabase/server.ts` — the regular authenticated client, **not** `createServiceClient`), `appError` (Phase 1's `lib/errors.ts`), `SubmitEmployerVerificationSchema` (Task 1 — re-validated here as defense-in-depth, matching Phase 2's `updateOwnProfile` precedent of re-parsing rather than trusting the caller already did).

- [ ] **Step 1: Write the service layer**

Create `lib/services/employer-verifications.ts`:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import { SubmitEmployerVerificationSchema } from '@/lib/validations/employer-verification'

export interface EmployerVerificationStatus {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason: string | null
  submittedAt: string
}

export async function getLatestEmployerVerification(): Promise<EmployerVerificationStatus | null> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employer_verifications')
    .select('id, status, rejection_reason, submitted_at')
    .eq('user_id', user.id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
  if (!data) {
    return null
  }

  return {
    id: data.id,
    status: data.status as EmployerVerificationStatus['status'],
    rejectionReason: data.rejection_reason,
    submittedAt: data.submitted_at,
  }
}

export interface SubmitEmployerVerificationInput {
  fullNameOnKtp: string
  ktpNumber: string
  file: File
}

export async function submitEmployerVerification(
  input: SubmitEmployerVerificationInput
): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const validated = SubmitEmployerVerificationSchema.parse({
    fullNameOnKtp: input.fullNameOnKtp,
    ktpNumber: input.ktpNumber,
  })

  const supabase = await createClient()
  const path = `${user.id}/${Date.now()}-${input.file.name}`

  const { error: uploadError } = await supabase.storage
    .from('kyc-documents')
    .upload(path, input.file, { contentType: input.file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah dokumen KTP.')
  }

  const { error: insertError } = await supabase.from('employer_verifications').insert({
    user_id: user.id,
    full_name_on_ktp: validated.fullNameOnKtp,
    ktp_number: validated.ktpNumber,
    ktp_document_path: path,
  })

  if (insertError) {
    if (insertError.code === '23505') {
      throw appError(
        'CONFLICT',
        'Anda masih memiliki pengajuan yang menunggu peninjauan.'
      )
    }
    throw appError('INTERNAL_ERROR')
  }
}
```

Note: this uses the regular authenticated client throughout, deliberately — unlike Phase 2's `profiles` DAL, nothing here needs the service-role client. Both the storage write (`kyc_documents_insert_own`, Phase 1) and the table write (`employer_verifications_insert_own`, Task 2) are already permitted by RLS for the row's own owner.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. (No UI consumes this yet — that's Task 4. Like Phase 2's profile DAL, this has no automated test here because every path requires a real authenticated session and a real Supabase connection; it's exercised end-to-end once Task 4's UI exists, verified manually in Task 7.)

- [ ] **Step 3: Commit**

```bash
git add lib/services
git commit -m "feat(verification): add employer verification service layer"
```

---

### Task 4: Worker-facing verification page

**Files:**
- Create: `app/verification/actions.ts`
- Create: `app/verification/page.tsx`
- Create: `app/verification/verification-form.tsx`
- Modify: `app/profile/page.tsx` (add a link to `/verification`)

**Interfaces:**
- Consumes: `getLatestEmployerVerification`, `submitEmployerVerification`, `EmployerVerificationStatus` (Task 3); `SubmitEmployerVerificationSchema`, `SubmitEmployerVerificationFormState` (Task 1); `toSafeErrorMessage` (Phase 1's `lib/errors.ts`).
- Produces: `submitEmployerVerificationAction(prevState, formData)`.

- [ ] **Step 1: Create the Server Action**

Create `app/verification/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { submitEmployerVerification } from '@/lib/services/employer-verifications'
import {
  SubmitEmployerVerificationSchema,
  type SubmitEmployerVerificationFormState,
} from '@/lib/validations/employer-verification'
import { toSafeErrorMessage } from '@/lib/errors'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf']

export async function submitEmployerVerificationAction(
  _prevState: SubmitEmployerVerificationFormState,
  formData: FormData
): Promise<SubmitEmployerVerificationFormState> {
  const validatedFields = SubmitEmployerVerificationSchema.safeParse({
    fullNameOnKtp: formData.get('fullNameOnKtp'),
    ktpNumber: formData.get('ktpNumber'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  const file = formData.get('ktpDocument')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Dokumen KTP wajib diunggah.'] } }
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { errors: { file: ['Format file harus JPEG, PNG, atau PDF.'] } }
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { errors: { file: ['Ukuran file maksimal 10MB.'] } }
  }

  try {
    await submitEmployerVerification({ ...validatedFields.data, file })
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/verification')
  return { message: 'Pengajuan berhasil dikirim. Menunggu peninjauan Admin.' }
}
```

- [ ] **Step 2: Create the verification form (client component)**

Create `app/verification/verification-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { submitEmployerVerificationAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function VerificationForm() {
  const [state, action, pending] = useActionState(submitEmployerVerificationAction, undefined)

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullNameOnKtp">Nama Lengkap (sesuai KTP)</Label>
        <Input id="fullNameOnKtp" name="fullNameOnKtp" required />
        {state?.errors?.fullNameOnKtp && (
          <p className="text-sm text-destructive">{state.errors.fullNameOnKtp[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ktpNumber">Nomor KTP</Label>
        <Input id="ktpNumber" name="ktpNumber" inputMode="numeric" required />
        {state?.errors?.ktpNumber && (
          <p className="text-sm text-destructive">{state.errors.ktpNumber[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ktpDocument">Foto/Scan KTP</Label>
        <Input
          id="ktpDocument"
          name="ktpDocument"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          required
        />
        {state?.errors?.file && (
          <p className="text-sm text-destructive">{state.errors.file[0]}</p>
        )}
      </div>
      {state?.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengirim...' : 'Ajukan Verifikasi'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the verification page (server component)**

Create `app/verification/page.tsx`:

```tsx
import Link from 'next/link'
import { getLatestEmployerVerification } from '@/lib/services/employer-verifications'
import { VerificationForm } from './verification-form'

export default async function VerificationPage() {
  const verification = await getLatestEmployerVerification()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pemberi Kerja</h1>

      {verification?.status === 'pending' && (
        <p className="text-sm text-muted-foreground">
          Pengajuan Anda sedang menunggu peninjauan Admin.
        </p>
      )}

      {verification?.status === 'approved' && (
        <p className="text-sm text-muted-foreground">
          Anda sudah terverifikasi sebagai Pemberi Kerja.
        </p>
      )}

      {verification?.status === 'rejected' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-destructive">
            Pengajuan sebelumnya ditolak
            {verification.rejectionReason ? `: ${verification.rejectionReason}` : '.'}
          </p>
          <VerificationForm />
        </div>
      )}

      {!verification && (
        <>
          <p className="text-sm text-muted-foreground">
            Ajukan verifikasi untuk dapat membuat pekerjaan sebagai Pemberi Kerja.
          </p>
          <VerificationForm />
        </>
      )}

      <Link href="/profile" className="text-sm text-primary underline-offset-4 hover:underline">
        Kembali ke profil
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Link to `/verification` from the profile page**

Edit `app/profile/page.tsx` — add a `Link` import and one line above `<ProfileForm profile={profile} />`:

```tsx
import Link from 'next/link'
```

```tsx
      <AvatarUploader userId={profile.id} currentAvatarUrl={profile.avatarUrl} />
      <Link href="/verification" className="text-sm text-primary underline-offset-4 hover:underline">
        Ajukan jadi Pemberi Kerja
      </Link>
      <ProfileForm profile={profile} />
```

(Without this, `/verification` would only be reachable by typing the URL directly — this is a one-line addition, not a navigation redesign; a proper site-wide nav is out of scope for this phase, same as it was for Phase 2.)

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add app/verification app/profile
git commit -m "feat(verification): add worker-facing verification request page"
```

---

### Task 5: Admin route authorization guard

**Files:**
- Create: `app/admin/layout.tsx`

**Interfaces:**
- Consumes: `requireRole` (Phase 1's `lib/auth/get-current-user.ts`).
- Produces: an authorization boundary every subsequent `/admin/*` page renders inside — Task 6's pages are the first to rely on it, and every future admin page (added in later phases, per the Implementation Prompt's STEP 12) reuses this same layout without modification.

- [ ] **Step 1: Write the guard**

Create `app/admin/layout.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/get-current-user'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireRole('admin')
  } catch {
    notFound()
  }

  return <>{children}</>
}
```

A non-admin (including a logged-out visitor, since `requireRole` throws `UNAUTHENTICATED` first) gets a plain 404 rather than a redirect to login — this avoids revealing that `/admin/*` exists at all to someone who isn't authorized to use it, and avoids a confusing redirect loop for an already-logged-in non-admin user.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. (No page renders under this layout yet — that's Task 6. `requireRole('admin')` cannot be exercised without a real admin session, so this is verified manually in Task 7 alongside the pages that use it.)

- [ ] **Step 3: Commit**

```bash
git add app/admin
git commit -m "feat(admin): add admin route authorization guard"
```

---

### Task 6: Admin employer verification review

**Files:**
- Create: `app/admin/employer-verifications/actions.ts`
- Create: `app/admin/employer-verifications/page.tsx`
- Create: `app/admin/employer-verifications/[id]/page.tsx`
- Create: `app/admin/employer-verifications/[id]/review-form.tsx`

**Interfaces:**
- Consumes: `requireRole` (Phase 1); `createClient` (Phase 1's `lib/supabase/server.ts`); `appError`, `toSafeErrorMessage` (Phase 1's `lib/errors.ts`); the `app/admin/layout.tsx` guard (Task 5); the `review_employer_verification` DB function and regenerated types (Task 2).
- Produces: `reviewEmployerVerificationAction(verificationId, decision, rejectionReason?)`.

Before writing `app/admin/employer-verifications/[id]/page.tsx`, check `node_modules/next/dist/docs/` for this Next.js version's exact dynamic route `params` API (it's `Promise`-wrapped in recent versions — confirm the precise shape rather than assuming from training data, per this repo's `AGENTS.md`).

- [ ] **Step 1: Create the review Server Action**

Create `app/admin/employer-verifications/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError, toSafeErrorMessage, type ErrorCode } from '@/lib/errors'

function mapReviewError(message: string): { code: ErrorCode; message?: string } {
  if (message.includes('FORBIDDEN')) return { code: 'FORBIDDEN' }
  if (message.includes('CONFLICT')) {
    return { code: 'CONFLICT', message: 'Pengajuan ini sudah ditinjau sebelumnya.' }
  }
  if (message.includes('NOT_FOUND')) return { code: 'NOT_FOUND' }
  if (message.includes('rejection_reason required')) {
    return { code: 'VALIDATION_ERROR', message: 'Alasan penolakan wajib diisi.' }
  }
  if (message.includes('VALIDATION_ERROR')) return { code: 'VALIDATION_ERROR' }
  return { code: 'INTERNAL_ERROR' }
}

export async function reviewEmployerVerificationAction(
  verificationId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await requireRole('admin')

    const supabase = await createClient()
    const { error } = await supabase.rpc('review_employer_verification', {
      p_verification_id: verificationId,
      p_decision: decision,
      p_rejection_reason: rejectionReason ?? null,
    })

    if (error) {
      const mapped = mapReviewError(error.message)
      throw appError(mapped.code, mapped.message)
    }
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/employer-verifications')
  revalidatePath(`/admin/employer-verifications/${verificationId}`)
  return { success: true }
}
```

(`ErrorCode` is already exported from `lib/errors.ts` as of Phase 1 — no change needed there.)

- [ ] **Step 2: Create the list page**

Create `app/admin/employer-verifications/page.tsx`:

```tsx
import Link from 'next/link'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'

export default async function EmployerVerificationsListPage() {
  await requireRole('admin')

  const supabase = await createClient()
  const { data } = await supabase
    .from('employer_verifications')
    .select('id, status, full_name_on_ktp, submitted_at')
    .order('submitted_at', { ascending: false })

  const verifications = data ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pemberi Kerja</h1>
      {verifications.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {verifications.map((v) => (
          <li key={v.id}>
            <Link
              href={`/admin/employer-verifications/${v.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span>{v.full_name_on_ktp}</span>
              <span className="text-muted-foreground">{v.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Create the review form (client component)**

Create `app/admin/employer-verifications/[id]/review-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewEmployerVerificationAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ReviewForm({ verificationId }: { verificationId: string }) {
  const router = useRouter()
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDecision(decision: 'approved' | 'rejected') {
    setError(null)
    if (decision === 'rejected' && rejectionReason.trim().length === 0) {
      setError('Alasan penolakan wajib diisi.')
      return
    }
    startTransition(async () => {
      const result = await reviewEmployerVerificationAction(
        verificationId,
        decision,
        decision === 'rejected' ? rejectionReason : undefined
      )
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/employer-verifications')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rejectionReason">Alasan Penolakan (wajib jika menolak)</Label>
        <Input
          id="rejectionReason"
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={isPending} onClick={() => handleDecision('approved')}>
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

- [ ] **Step 4: Create the detail/review page**

Create `app/admin/employer-verifications/[id]/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { ReviewForm } from './review-form'

export default async function EmployerVerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin')

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('employer_verifications')
    .select('id, status, full_name_on_ktp, ktp_number, ktp_document_path, rejection_reason, submitted_at')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    notFound()
  }

  const { data: signedUrlData } = await supabase.storage
    .from('kyc-documents')
    .createSignedUrl(data.ktp_document_path, 60)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{data.full_name_on_ktp}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Nomor KTP</dt>
          <dd>{data.ktp_number}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{data.status}</dd>
        </div>
        {data.rejection_reason && (
          <div>
            <dt className="text-muted-foreground">Alasan Penolakan Sebelumnya</dt>
            <dd>{data.rejection_reason}</dd>
          </div>
        )}
      </dl>
      {signedUrlData?.signedUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
        <img src={signedUrlData.signedUrl} alt="Dokumen KTP" className="w-full rounded border" />
      )}
      {data.status === 'pending' && <ReviewForm verificationId={data.id} />}
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
git add app/admin
git commit -m "feat(admin): add employer verification review pages"
```

---

### Task 7: Phase 3 Definition-of-Done verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be Phase 2's 32 + Task 1's 6 = 38.

- [ ] **Step 2: Provision the first admin account**

There is no in-app way to do this, by design. Run this once in the Supabase Dashboard → SQL Editor, replacing the email with an account that already exists (register it first at `/auth/register` if it doesn't):

```sql
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users where email = 'REPLACE_WITH_ADMIN_EMAIL'
on conflict (user_id, role) do nothing;
```

- [ ] **Step 3: Create a throwaway worker test user**

Mirrors Phase 2's Task 8 pattern — run as a one-off Node script from the repo root (do not commit it):

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
supabase.auth.admin.createUser({
  email: 'phase3-verify@example.com',
  password: 'password1',
  email_confirm: true,
  user_metadata: { full_name: 'Phase 3 Verifier', phone: '081200000001' },
}).then(({ data, error }) => console.log(JSON.stringify({ data, error }, null, 2)));
"
```

- [ ] **Step 4: Verify the full flow in a real browser**

```bash
npm run dev
```

Using a real browser, logged in as `phase3-verify@example.com` / `password1`:
1. Visit `/verification` — confirm the request form appears (no prior verification exists).
2. Submit the form with a real name, a 16-digit number, and a small JPEG/PNG/PDF file — confirm the "menunggu peninjauan" message appears.
3. Submit again immediately — confirm it's rejected with the "masih memiliki pengajuan yang menunggu peninjauan" message (the partial unique index doing its job).
4. Log out, log in as the admin account from Step 2, visit `/admin/employer-verifications` — confirm the pending request appears.
5. Open its detail page — confirm the KTP document image renders, and the name/number match what was submitted.
6. Click **Tolak** without a rejection reason — confirm it's rejected client-side or server-side with a clear message (the DB function requires a non-empty reason).
7. Fill in a rejection reason and click **Tolak** — confirm you're returned to the list, the status shows `rejected`.
8. Log back in as the worker — confirm `/verification` shows the rejection reason and the form again ("Ajukan Lagi" case), then submit a **second** request successfully (proves resubmission works and the partial unique index only blocks concurrent *pending* rows, not historical ones).
9. As admin, approve this second request — confirm you're returned to the list with status `approved`.
10. Separately verify (via a one-off script using the service-role client, or the Supabase Dashboard's Table Editor) that the worker's `user_roles` now includes an `employer` row, and `audit_logs` has both an `EMPLOYER_REJECTED` and an `EMPLOYER_APPROVED` row referencing this user's verification requests.
11. As a logged-in **worker** (non-admin), visit `/admin/employer-verifications` directly — confirm you get a 404, not the page content.
12. Reopen the detail page for the request approved in check 9 (already `approved`) and try clicking **Setujui** again (or call `reviewEmployerVerificationAction` a second time for the same id, e.g. from the browser console) — confirm it's rejected with the "sudah ditinjau sebelumnya" conflict message, not silently re-processed or double-logged in `audit_logs`.

- [ ] **Step 5: Clean up the test user**

```bash
node -e "
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
supabase.auth.admin.listUsers().then(({ data }) => {
  const user = data.users.find(u => u.email === 'phase3-verify@example.com');
  if (user) return supabase.auth.admin.deleteUser(user.id).then(() => console.log('deleted', user.id));
  console.log('no test user found');
});
"
```

- [ ] **Step 6: Report results**

Note clearly which of Step 4's 11 checks passed. If any fail, do not mark Phase 3 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 3 Definition of Done

- [ ] A worker can submit an employer verification request (name, KTP number, document) and sees the correct status view depending on whether they have no request / a pending one / an approved one / a rejected one.
- [ ] A second submission while one is already pending is rejected with a clear message (partial unique index enforced).
- [ ] After a rejection, resubmission works and creates a new, independent request.
- [ ] `/admin/employer-verifications` and its detail page are reachable only by an admin — a non-admin (including a logged-out visitor) gets a 404.
- [ ] The admin can view the submitted KTP document (via a short-lived signed URL) and the submitted name/number.
- [ ] Approving a request atomically: changes its status to `approved`, grants the `employer` role, and writes an `EMPLOYER_APPROVED` audit log row.
- [ ] Rejecting a request requires a non-empty reason, atomically changes its status to `rejected`, records the reason, and writes an `EMPLOYER_REJECTED` audit log row.
- [ ] A second admin (or a repeated click) attempting to review an already-decided request is rejected with a clear conflict message, not silently accepted or double-processed.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
