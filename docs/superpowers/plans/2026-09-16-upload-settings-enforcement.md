# Upload Settings Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `platform_settings.max_upload_size_mb`/`allowed_file_types` (admin-configurable since Phase 11, currently read nowhere) actually govern every upload in the app, and give avatar upload real server-side validation for the first time.

**Architecture:** A new shared module (`lib/upload-limits.ts`) computes, per upload type, `min(that type's own hardcoded ceiling, the admin's global max size)` and the *intersection* of that type's own allowed mime types with the admin's global allowed list — so the admin setting can only tighten each upload type, never loosen it past its own domain-correct rules (an avatar still can't become a video no matter how the setting is configured), and no storage bucket needs to change. Five existing Server Actions each swap two hardcoded `if` checks for one call into this module. Avatar upload is restructured from a direct-to-browser Supabase Storage upload (no server validation at all today) into a Server-Action-mediated one, matching every other upload type's existing architecture.

**Tech Stack:** Next.js 16.3.4 (Server Actions, Server Components), Supabase (Postgres, Storage, RLS — no new RPCs), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-upload-settings-enforcement-design.md`

## Global Constraints

- **Enforcement model (spec §2):** effective max size = `min(context's own hardcoded ceiling, platform_settings.max_upload_size_mb)`; effective allowed types = `context's own hardcoded allowed set ∩ platform_settings.allowed_file_types`. Never validate directly against the raw platform_settings value alone.
- **No storage bucket changes.** No migration touches `storage.buckets`; every bucket's `file_size_limit`/`allowed_mime_types` stays exactly as it is today.
- **No new RPCs, no new RLS policies.** `platform_settings`'s existing `platform_settings_select_authenticated` policy (`to authenticated using (true)`) already permits the read this phase needs.
- **The seed-data migration uses plain `update` statements**, never the `update_platform_setting` RPC (that RPC's `is_admin()` check requires `auth.uid()`, unavailable in a migration).
- **Avatar's upload path is always server-generated** (`${user.id}/${Date.now()}-${file.name}`) from the authenticated session — never accepted from the client. This is a hard requirement, not a style preference: it's what makes the old client-supplied-path validation logic in `updateOwnAvatar` obsolete and removable.
- **Only `computeEffectiveLimits` and `validateUploadedFile` (pure functions, no I/O) get automated unit tests.** No automated tests for any of the 5 wired-up Server Actions or for `getUploadSettings` itself — Supabase-dependent, matches every prior phase's convention, verified manually in the final task instead.
- **Files with `import 'server-only'` need `vi.mock('server-only', () => ({}))` at the top of their test file** to be importable under Vitest — see the existing `lib/services/profiles.test.ts` for the established pattern.

---

### Task 1: Seed-data correction migration

**Files:**
- Create: `supabase/migrations/<timestamp>_upload_settings_seed_correction.sql`

**Interfaces:**
- Produces: `platform_settings` rows for `max_upload_size_mb` (now `20`) and `allowed_file_types` (now including `application/pdf`) — consumed at runtime by Task 2's `getUploadSettings()`, no compile-time interface.

- [ ] **Step 1: Re-link and verify the Supabase CLI**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
npx supabase migration list
```

Expected: every existing migration shows applied on both `Local` and `Remote`. If anything is missing from Remote, stop and investigate before continuing.

- [ ] **Step 2: Create the migration file**

```bash
npx supabase migration new upload_settings_seed_correction
```

Note the generated filename (e.g. `supabase/migrations/20260916120000_upload_settings_seed_correction.sql`) — edit that exact file in the next step.

- [ ] **Step 3: Write the migration**

Replace the file's contents with:

```sql
-- Upload settings enforcement (spec docs/superpowers/specs/2026-09-16-upload-settings-enforcement-design.md
-- §6): correct the Phase 1 seed values before any code reads them for real
-- enforcement. The original seed (5MB, no PDF) would immediately regress
-- real upload flows that already work today: job completion evidence
-- allows up to 20MB video, and KTP/payment-proof/withdrawal-proof/
-- refund-proof all allow PDF. 20MB plus the union of every upload type's
-- own allowed mime types preserves today's actual behavior unchanged; an
-- admin can still tighten either value afterward via /admin/settings.
--
-- Plain `update` statements, not the update_platform_setting RPC -- that
-- RPC's is_admin() check requires auth.uid(), unavailable in a migration.

update public.platform_settings
set value = '20'
where key = 'max_upload_size_mb';

update public.platform_settings
set value = '["image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf"]'
where key = 'allowed_file_types';
```

- [ ] **Step 4: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`.

- [ ] **Step 5: Verify**

```bash
npx supabase migration list
```

Expected: the new migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations
git commit -m "fix(settings): correct seeded upload size/type defaults before enforcing them"
```

(No `database.types.ts` regeneration needed — this migration changes row data, not schema structure.)

---

### Task 2: Shared upload-limits module

**Files:**
- Modify: `lib/services/admin-settings.ts` (add one export, no changes to existing ones)
- Create: `lib/upload-limits.ts`
- Test: `lib/upload-limits.test.ts`

**Interfaces:**
- Produces: `getUploadSettings(): Promise<{ maxUploadSizeMb: number; allowedFileTypes: string[] }>` (in `lib/services/admin-settings.ts`) — consumed by `lib/upload-limits.ts`'s `getEffectiveUploadLimits` in this same task.
- Produces: `UploadContext` (union type: `'avatar' | 'ktp' | 'paymentProof' | 'jobEvidence' | 'withdrawalProof' | 'refundProof'`), `UploadCeiling` (`{ maxSizeBytes: number; allowedTypes: string[] }`), `UPLOAD_CEILINGS: Record<UploadContext, UploadCeiling>`, `computeEffectiveLimits(ceiling, platformMaxSizeMb, platformAllowedTypes): UploadCeiling`, `validateUploadedFile(file: File, limits: UploadCeiling): string | null`, `getEffectiveUploadLimits(context: UploadContext): Promise<UploadCeiling>` (all in `lib/upload-limits.ts`) — consumed by Task 3 (the 5 wired actions) and Task 4 (avatar).

- [ ] **Step 1: Add `getUploadSettings` to `lib/services/admin-settings.ts`**

Append to the end of the file (its existing `import 'server-only'`, `requireRole`, `createClient`, `appError` imports already cover everything this needs — no new imports required):

```ts

export interface UploadSettings {
  maxUploadSizeMb: number
  allowedFileTypes: string[]
}

// No requireRole('admin') here: platform_settings' own RLS policy
// (platform_settings_select_authenticated, `to authenticated using (true)`)
// already permits every signed-in user to read it -- the admin-only gate on
// getAllPlatformSettings above is an app-level choice for the settings-editing
// page, not a database restriction. Every upload action needs this read
// regardless of the caller's role.
export async function getUploadSettings(): Promise<UploadSettings> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', ['max_upload_size_mb', 'allowed_file_types'])

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const valueByKey = new Map((data ?? []).map((row) => [row.key, row.value]))
  return {
    maxUploadSizeMb: Number(valueByKey.get('max_upload_size_mb') ?? 5),
    allowedFileTypes: (valueByKey.get('allowed_file_types') ?? []) as string[],
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Write the failing test file `lib/upload-limits.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { computeEffectiveLimits, validateUploadedFile, UPLOAD_CEILINGS } from './upload-limits'

function makeFile(type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], 'test-file', { type })
}

describe('computeEffectiveLimits', () => {
  it('uses the platform max size when it is smaller than the context ceiling', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.jobEvidence, 5, ['image/jpeg'])
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('uses the context ceiling when the platform max size is larger', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.avatar, 50, ['image/jpeg'])
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('uses the same value when the platform max size exactly equals the context ceiling', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.avatar, 5, ['image/jpeg'])
    expect(result.maxSizeBytes).toBe(5 * 1024 * 1024)
  })

  it('intersects allowed types, dropping types the platform setting does not include', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.jobEvidence, 20, ['image/jpeg', 'image/png'])
    expect(result.allowedTypes).toEqual(['image/jpeg', 'image/png'])
  })

  it('produces an empty allowed-types list when the platform setting has no overlap at all', () => {
    const result = computeEffectiveLimits(UPLOAD_CEILINGS.avatar, 20, ['application/pdf'])
    expect(result.allowedTypes).toEqual([])
  })
})

describe('validateUploadedFile', () => {
  const limits = { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png'] }

  it('accepts a file within the type and size limits', () => {
    const file = makeFile('image/jpeg', 1024)
    expect(validateUploadedFile(file, limits)).toBeNull()
  })

  it('rejects a disallowed type and names the effective allowed types in the message', () => {
    const file = makeFile('application/pdf', 1024)
    expect(validateUploadedFile(file, limits)).toBe('Format file harus JPEG, PNG.')
  })

  it('rejects an oversized file and states the effective MB ceiling in the message', () => {
    const file = makeFile('image/jpeg', 11 * 1024 * 1024)
    expect(validateUploadedFile(file, limits)).toBe('Ukuran file maksimal 10MB.')
  })

  it('falls back to a no-types-allowed message when the effective allowed types list is empty', () => {
    const file = makeFile('image/jpeg', 1024)
    expect(validateUploadedFile(file, { maxSizeBytes: limits.maxSizeBytes, allowedTypes: [] })).toBe(
      'Tidak ada format file yang diizinkan Admin untuk unggahan ini.'
    )
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
npx vitest run lib/upload-limits.test.ts
```

Expected: FAIL — `lib/upload-limits.ts` does not exist yet (module not found).

- [ ] **Step 5: Create `lib/upload-limits.ts`**

```ts
import 'server-only'
import { getUploadSettings } from '@/lib/services/admin-settings'

export type UploadContext =
  | 'avatar'
  | 'ktp'
  | 'paymentProof'
  | 'jobEvidence'
  | 'withdrawalProof'
  | 'refundProof'

export interface UploadCeiling {
  maxSizeBytes: number
  allowedTypes: string[]
}

export const UPLOAD_CEILINGS: Record<UploadContext, UploadCeiling> = {
  avatar: { maxSizeBytes: 5 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  ktp: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
  paymentProof: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
  jobEvidence: {
    maxSizeBytes: 20 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
  },
  withdrawalProof: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
  refundProof: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
}

const TYPE_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'video/mp4': 'MP4',
  'application/pdf': 'PDF',
}

export function computeEffectiveLimits(
  ceiling: UploadCeiling,
  platformMaxSizeMb: number,
  platformAllowedTypes: string[]
): UploadCeiling {
  return {
    maxSizeBytes: Math.min(ceiling.maxSizeBytes, platformMaxSizeMb * 1024 * 1024),
    allowedTypes: ceiling.allowedTypes.filter((type) => platformAllowedTypes.includes(type)),
  }
}

export function validateUploadedFile(file: File, limits: UploadCeiling): string | null {
  if (!limits.allowedTypes.includes(file.type)) {
    const typeList = limits.allowedTypes.map((type) => TYPE_LABELS[type] ?? type).join(', ')
    return typeList
      ? `Format file harus ${typeList}.`
      : 'Tidak ada format file yang diizinkan Admin untuk unggahan ini.'
  }
  if (file.size > limits.maxSizeBytes) {
    const maxMb = Math.floor(limits.maxSizeBytes / (1024 * 1024))
    return `Ukuran file maksimal ${maxMb}MB.`
  }
  return null
}

export async function getEffectiveUploadLimits(context: UploadContext): Promise<UploadCeiling> {
  const settings = await getUploadSettings()
  return computeEffectiveLimits(UPLOAD_CEILINGS[context], settings.maxUploadSizeMb, settings.allowedFileTypes)
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx vitest run lib/upload-limits.test.ts
```

Expected: PASS, 9/9 tests.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit
npx eslint .
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/services/admin-settings.ts lib/upload-limits.ts lib/upload-limits.test.ts
git commit -m "feat(uploads): add shared upload-limits module wired to platform_settings"
```

---

### Task 3: Wire the 5 already-server-validated upload actions

**Files:**
- Modify: `app/(main)/verification/actions.ts`
- Modify: `app/(main)/jobs/[id]/payment/actions.ts`
- Modify: `app/(main)/jobs/[id]/completion/actions.ts`
- Modify: `app/admin/withdrawals/[id]/actions.ts`
- Modify: `app/admin/payments/actions.ts`

**Interfaces:**
- Consumes: `getEffectiveUploadLimits`, `validateUploadedFile` (Task 2).

- [ ] **Step 1: Replace `app/(main)/verification/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { submitEmployerVerification } from '@/lib/services/employer-verifications'
import {
  SubmitEmployerVerificationSchema,
  type SubmitEmployerVerificationFormState,
} from '@/lib/validations/employer-verification'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

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
  const limits = await getEffectiveUploadLimits('ktp')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
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

- [ ] **Step 2: Replace `app/(main)/jobs/[id]/payment/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { submitPaymentProof } from '@/lib/services/payments'
import { SubmitPaymentProofSchema, type PaymentProofFormState } from '@/lib/validations/payment'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export async function submitPaymentProofAction(
  paymentId: string,
  jobId: string,
  _prevState: PaymentProofFormState,
  formData: FormData
): Promise<PaymentProofFormState> {
  const validatedFields = SubmitPaymentProofSchema.safeParse({
    transferDate: formData.get('transferDate'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti transfer wajib diunggah.'] } }
  }
  const limits = await getEffectiveUploadLimits('paymentProof')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
  }

  try {
    await submitPaymentProof(paymentId, file, validatedFields.data.transferDate)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/payment`)
  revalidatePath(`/jobs/${jobId}`)
  return undefined
}
```

- [ ] **Step 3: Replace `app/(main)/jobs/[id]/completion/actions.ts`**

Only `recordJobEvidenceAction` changes; `submitJobCompletionAction`/`confirmJobCompletionAction` are untouched but reproduced below since this is a full-file replacement:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import {
  recordJobEvidence,
  submitJobCompletion,
  confirmJobCompletion,
} from '@/lib/services/completions'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

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
  const limits = await getEffectiveUploadLimits('jobEvidence')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
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

- [ ] **Step 4: Replace `app/admin/withdrawals/[id]/actions.ts`**

Only `markWithdrawalPaidAction` changes; `processWithdrawalAction`/`rejectWithdrawalAction` are untouched but reproduced below since this is a full-file replacement:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { processWithdrawal, rejectWithdrawal, markWithdrawalPaid } from '@/lib/services/withdrawals'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

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
  const limits = await getEffectiveUploadLimits('withdrawalProof')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
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

- [ ] **Step 5: Replace `app/admin/payments/actions.ts`**

Only `markRefundPaidAction` changes; `cancelJobAndRefundAction`/`reviewPaymentAction` are untouched but reproduced below since this is a full-file replacement:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { reviewPayment } from '@/lib/services/payments'
import { cancelJobAndRefund, markRefundPaid } from '@/lib/services/refunds'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export async function cancelJobAndRefundAction(
  jobId: string,
  reason: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await cancelJobAndRefund(jobId, reason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}

export type MarkRefundPaidFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function markRefundPaidAction(
  paymentId: string,
  _prevState: MarkRefundPaidFormState,
  formData: FormData
): Promise<MarkRefundPaidFormState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti transfer wajib diunggah.'] } }
  }
  const limits = await getEffectiveUploadLimits('refundProof')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
  }

  try {
    await markRefundPaid(paymentId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${paymentId}`)
  return undefined
}

export async function reviewPaymentAction(
  paymentId: string,
  decision: 'verified' | 'rejected',
  rejectionReason?: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await reviewPayment(paymentId, decision, rejectionReason)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/payments')
  revalidatePath(`/admin/payments/${paymentId}`)
  return { success: true }
}
```

- [ ] **Step 6: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add "app/(main)/verification/actions.ts" "app/(main)/jobs/[id]/payment/actions.ts" "app/(main)/jobs/[id]/completion/actions.ts" app/admin/withdrawals app/admin/payments/actions.ts
git commit -m "feat(uploads): enforce platform_settings limits on KTP, payment, evidence, and proof uploads"
```

---

### Task 4: Avatar upload becomes server-validated

**Files:**
- Modify: `lib/services/profiles.ts`
- Modify: `app/(main)/profile/actions.ts`
- Modify: `app/(main)/profile/avatar-uploader.tsx`
- Modify: `app/(main)/profile/page.tsx`
- Test: `lib/services/profiles.test.ts` (rewrite the `updateOwnAvatar` block, not extend it)

**Interfaces:**
- Consumes: `getEffectiveUploadLimits`, `validateUploadedFile` (Task 2).
- Produces: `updateOwnAvatar(file: File): Promise<string>` (signature change from `(path: string)`) — no other task depends on this.

- [ ] **Step 1: Add the `createClient` import to `lib/services/profiles.ts`**

Change the top of the file from:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { UpdateProfileSchema } from '@/lib/validations/profile'
```

to:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { UpdateProfileSchema } from '@/lib/validations/profile'
```

- [ ] **Step 2: Replace `updateOwnAvatar`**

Replace the entire existing `updateOwnAvatar` function (currently the last function in the file, taking a `path: string`) with:

```ts
export async function updateOwnAvatar(file: File): Promise<string> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const path = `${user.id}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { contentType: file.type, upsert: true })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah avatar.')
  }

  const serviceClient = createServiceClient()
  const { data: publicUrlData } = serviceClient.storage.from('avatars').getPublicUrl(path)
  const avatarUrl = publicUrlData.publicUrl

  const { error } = await serviceClient.from('profiles').update({ avatar_url: avatarUrl }).eq('id', user.id)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return avatarUrl
}
```

The path is now built entirely from the authenticated user's own id — the old `isOwnFolder` path-validation block is gone, since there is no longer a client-supplied path to validate.

- [ ] **Step 3: Rewrite `lib/services/profiles.test.ts`'s `updateOwnAvatar` tests**

Replace the entire file with:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { updateOwnAvatar } from './profiles'

const OWN_USER_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const PUBLIC_URL = 'https://example.supabase.co/storage/v1/object/public/avatars/avatar.png'

function makeAvatarFile(): File {
  return new File([new Uint8Array(1024)], 'avatar.png', { type: 'image/png' })
}

function mockAuthClient(uploadError: { message: string } | null) {
  return {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: uploadError }),
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>
}

function mockServiceClient(updateError: { message: string } | null = null) {
  return {
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: PUBLIC_URL } }),
      }),
    },
    from: () => ({
      update: () => ({
        eq: () => ({ error: updateError }),
      }),
    }),
  } as unknown as ReturnType<typeof createServiceClient>
}

describe('updateOwnAvatar', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: OWN_USER_ID,
      email: 'user@example.com',
      roles: [],
    })
  })

  it("uploads to a path scoped to the authenticated user's own id and returns the public URL", async () => {
    vi.mocked(createClient).mockResolvedValue(mockAuthClient(null))
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient())

    const result = await updateOwnAvatar(makeAvatarFile())

    expect(result).toBe(PUBLIC_URL)
  })

  it('throws when the storage upload fails', async () => {
    vi.mocked(createClient).mockResolvedValue(mockAuthClient({ message: 'boom' }))
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient())

    await expect(updateOwnAvatar(makeAvatarFile())).rejects.toThrow()
  })

  it('throws when the profiles update fails', async () => {
    vi.mocked(createClient).mockResolvedValue(mockAuthClient(null))
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient({ message: 'boom' }))

    await expect(updateOwnAvatar(makeAvatarFile())).rejects.toThrow()
  })

  it('rejects an unauthenticated caller before touching storage', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    await expect(updateOwnAvatar(makeAvatarFile())).rejects.toThrow()
  })
})
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run lib/services/profiles.test.ts
```

Expected: PASS, 4/4 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors yet from this file, but `app/(main)/profile/actions.ts` and `avatar-uploader.tsx` will still fail until Steps 6-7 below — that's expected at this point, continue.

- [ ] **Step 6: Replace `app/(main)/profile/actions.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { updateOwnAvatar, updateOwnProfile } from '@/lib/services/profiles'
import { UpdateProfileSchema, type UpdateProfileFormState } from '@/lib/validations/profile'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export async function updateProfileAction(
  _prevState: UpdateProfileFormState,
  formData: FormData
): Promise<UpdateProfileFormState> {
  const validatedFields = UpdateProfileSchema.safeParse({
    fullName: formData.get('fullName'),
    phone: formData.get('phone'),
    address: formData.get('address'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await updateOwnProfile(validatedFields.data)
  } catch (error) {
    return { status: 'error', message: toSafeErrorMessage(error) }
  }

  revalidatePath('/profile')
  return { status: 'success', message: 'Profil berhasil diperbarui.' }
}

export async function updateAvatarAction(
  formData: FormData
): Promise<{ success: true; avatarUrl: string } | { success: false; message: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { success: false, message: 'Foto wajib diunggah.' }
  }

  const limits = await getEffectiveUploadLimits('avatar')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { success: false, message: validationError }
  }

  try {
    const avatarUrl = await updateOwnAvatar(file)
    revalidatePath('/profile')
    return { success: true, avatarUrl }
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }
}
```

- [ ] **Step 7: Replace `app/(main)/profile/avatar-uploader.tsx`**

```tsx
'use client'

import { useRef, useState, useTransition, type ChangeEvent } from 'react'
import { updateAvatarAction } from './actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

// Client-side pre-check only, for instant feedback -- the server performs
// the authoritative check against the live admin-configured settings.
const CLIENT_PRECHECK_MAX_BYTES = 5 * 1024 * 1024
const CLIENT_PRECHECK_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function AvatarUploader({ currentAvatarUrl }: { currentAvatarUrl: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }

    if (!CLIENT_PRECHECK_TYPES.includes(file.type)) {
      setError('Format file harus JPEG, PNG, atau WebP.')
      return
    }
    if (file.size > CLIENT_PRECHECK_MAX_BYTES) {
      setError('Ukuran file maksimal 5MB.')
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('file', file)
      const result = await updateAvatarAction(formData)
      if (!result.success) {
        setError(result.message)
        return
      }
      setAvatarUrl(result.avatarUrl)
    })
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        <AvatarImage src={avatarUrl ?? undefined} alt="Avatar" />
        <AvatarFallback>?</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? 'Mengunggah...' : 'Ganti Foto'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Update `app/(main)/profile/page.tsx`**

Change:

```tsx
      <AvatarUploader userId={profile.id} currentAvatarUrl={profile.avatarUrl} />
```

to:

```tsx
      <AvatarUploader currentAvatarUrl={profile.avatarUrl} />
```

- [ ] **Step 9: Typecheck, lint, build**

```bash
npx tsc --noEmit
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 10: Run the full test suite**

```bash
npx vitest run
```

Expected: all pass. Test count should be 88 (80 before this plan, minus 5 removed avatar path-traversal tests, plus 4 new avatar tests, plus 9 new `upload-limits.test.ts` tests).

- [ ] **Step 11: Commit**

```bash
git add lib/services/profiles.ts lib/services/profiles.test.ts "app/(main)/profile/actions.ts" "app/(main)/profile/avatar-uploader.tsx" "app/(main)/profile/page.tsx"
git commit -m "feat(profile): route avatar upload through a server-validated action"
```

---

### Task 5: Definition-of-Done verification

**Files:** none (verification only).

**This task must be genuinely executed with a real running app and a real browser (Playwright), not attested to from code review alone.** Playwright + Chromium should already be installed on this machine (used in prior phases of this repo) — do not reinstall; if `require('playwright')` doesn't resolve directly from this repo's `node_modules`, set `NODE_PATH` to the npx cache directory (find it via `find ~/.npm/_npx -maxdepth 2 -name playwright -type d 2>/dev/null` if unsure).

- [ ] **Step 1: Run the full verification suite**

```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed; 88 tests passing (see Task 4 Step 10).

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Leave it running for the rest of this task.

- [ ] **Step 3: Verify the migration's effect is visible**

Sign in as an existing admin account (or create one via the same `auth.admin.createUser` + `user_roles` pattern used in every prior phase's verification), visit `/admin/settings`, and confirm "Maximum upload size" shows `20` and "Allowed file types" includes `application/pdf` alongside the original four types.

- [ ] **Step 4: Verify tightening `allowed_file_types` is enforced**

As the admin, edit `/admin/settings` to set "Allowed file types" to just `image/jpeg, image/png, image/webp` (removing `video/mp4` and `application/pdf`), save.

As a worker account (create one if none exists), visit `/verification`:
1. Attempt to submit with a PDF file as the KTP document — confirm it's rejected with the message `Format file harus JPEG, PNG.` (the intersection of KTP's own `[jpeg, png, pdf]` ceiling with the admin's now-tightened `[jpeg, png, webp]` setting is `[jpeg, png]`).
2. Attempt again with a real JPEG file — confirm it succeeds and the verification is submitted.

- [ ] **Step 5: Verify tightening `max_upload_size_mb` is enforced**

As the admin, edit `/admin/settings` to set "Maximum upload size" to `1` (1MB), save.

As a worker, visit `/verification` (submit a fresh request if the previous one is no longer pending) and attempt to upload a KTP image file larger than 1MB but smaller than 10MB — confirm it's rejected with the message `Ukuran file maksimal 1MB.`

- [ ] **Step 6: Restore settings to their post-migration defaults**

As the admin, set "Maximum upload size" back to `20` and "Allowed file types" back to `image/jpeg, image/png, image/webp, video/mp4, application/pdf`, save. Confirm `/admin/settings` reflects these values.

- [ ] **Step 7: Verify avatar upload end-to-end through the new Server Action**

As any worker account, visit `/profile` and upload a real JPEG or PNG image as the avatar — confirm the upload succeeds and the visible avatar image updates to the new photo. Refresh the page and confirm the new avatar persists.

- [ ] **Step 8: Clean up**

Delete any test accounts created for this verification (`auth.users` cascades to `profiles`/`user_roles`) and any employer-verification / avatar test data they created. Verify zero leftovers afterward.

- [ ] **Step 9: Report results**

Note clearly which of Steps 3-7's checks passed, with what was actually observed (not just "pass") — mirroring every prior phase's verification report format. If any fail, do not mark this phase complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Definition of Done

- [ ] `platform_settings.max_upload_size_mb` is `20` and `allowed_file_types` includes all five original context types (jpeg, png, webp, mp4, pdf) after the migration.
- [ ] Every one of the 6 upload contexts (avatar, KTP, payment proof, job evidence, withdrawal proof, refund proof) validates against `min(its own ceiling, the admin's global max size)` and the intersection of its own allowed types with the admin's global list.
- [ ] Tightening either admin setting genuinely narrows what a real upload accepts, verified against the real running app (Task 5, Steps 4-5).
- [ ] Avatar upload has real server-side validation for the first time — the browser no longer uploads directly to Supabase Storage; a Server Action does, after validating.
- [ ] No storage bucket definition changed.
- [ ] `npx tsc --noEmit`, `npx eslint .`, `npx vitest run` (88 tests), and `npm run build` all pass.
- [ ] Task 5's Steps 3-7 were genuinely executed against the real running app via Playwright, not attested to from code review.
