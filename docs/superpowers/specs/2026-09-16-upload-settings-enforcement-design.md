# Upload Settings Enforcement — Design

## 1. Purpose

The second of two sub-projects split off during Phase 12's brainstorming (the first, in-app navigation, is done and merged). PRD §39 names "Maximum upload size" and "Allowed file types" as admin-configurable platform settings, and `/admin/settings` (built in Phase 11) already lets an admin edit `platform_settings.max_upload_size_mb`/`allowed_file_types` — but nothing in the app ever reads them. Every one of the app's 6 upload flows (avatar, KTP/employer verification, payment proof, job completion evidence, withdrawal proof, refund proof) instead validates against its own separately hardcoded size/type constants, duplicated six times. Avatar upload additionally has **no server-side validation at all** today: the browser uploads directly to Supabase Storage, and the server only records whichever path it's told about afterward — unlike every other upload type, which already validates server-side before storing.

This phase wires the admin setting into real enforcement everywhere, and fixes avatar upload's missing server-side check. Presentation-only in spirit (no new business flow, no new RPC) but does require one schema-adjacent change: a migration correcting the current seed values (§6), because turning on enforcement using today's actual seeded numbers would immediately break real, working upload flows on day one (§2).

## 2. Enforcement model (the key decision)

Each upload type keeps its own hardcoded **domain ceiling** — the type-correctness rules that exist for real product reasons (an avatar must be an image, not a video; KTP/payment/withdrawal/refund proofs need to allow PDF). The admin's global `platform_settings` values become a **tightenable cap** on top of that ceiling, never a way to loosen it:

- **Effective max size** = `min(this upload type's own hardcoded ceiling, platform_settings.max_upload_size_mb)`
- **Effective allowed types** = `this upload type's own hardcoded allowed set ∩ platform_settings.allowed_file_types`

Rejected alternative: making every upload type validate directly against one fully uniform global value, with no per-type ceiling. That would need a second migration widening every storage bucket's own hardcoded `file_size_limit`/`allowed_mime_types` to match (otherwise the storage layer could reject something the app layer just approved), and would mean an admin's global settings could technically permit a video as an avatar. The chosen model needs no bucket migration at all — buckets stay exactly as strict as they are today, an unchanged defense-in-depth floor — and preserves domain-correctness unconditionally.

**Today's numbers, keyed by upload context** (unchanged from the current hardcoded constants, becoming named ceilings instead of duplicated literals):

| Context | Max size | Allowed types | Current file:line |
| --- | --- | --- | --- |
| `avatar` | 5MB | jpeg, png, webp | `app/(main)/profile/avatar-uploader.tsx:9-10` |
| `ktp` | 10MB | jpeg, png, pdf | `app/(main)/verification/actions.ts:11-12` |
| `paymentProof` | 10MB | jpeg, png, pdf | `app/(main)/jobs/[id]/payment/actions.ts:8-9` |
| `jobEvidence` | 20MB | jpeg, png, webp, mp4 | `app/(main)/jobs/[id]/completion/actions.ts:11-12` |
| `withdrawalProof` | 10MB | jpeg, png, pdf | `app/admin/withdrawals/[id]/actions.ts:7-8` |
| `refundProof` | 10MB | jpeg, png, pdf | `app/admin/payments/actions.ts:8-9` |

## 3. Out of scope (explicitly deferred)

- **Any change to storage bucket definitions.** They stay exactly as they are (§2) — no new migration touches `storage.buckets`.
- **`job-attachments` bucket.** Confirmed still unused by any application code (PRD §10's optional job attachment upload was never built) — not activated by this phase.
- **Admin-settings UI changes.** `/admin/settings`'s existing form for these two fields is untouched; it already round-trips correctly, it just wasn't being read anywhere until now.
- **Guarding against an admin configuring an unusable combination** (e.g. setting `allowed_file_types` to a value with zero overlap with a given context, making that upload type permanently rejected). Treated as an accepted consequence of full admin control, matching this app's existing pattern of trusting admin configuration (e.g. Phase 11 platform fee has no sanity-range warning either).
- **New RLS policies or RPCs.** `platform_settings`'s existing `platform_settings_select_authenticated` policy (`to authenticated using (true)`) already permits the read this phase needs (§4).

## 4. Shared upload-limits module (`lib/upload-limits.ts`, new)

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

`computeEffectiveLimits` and `validateUploadedFile` are pure (no I/O) — deliberately factored out of `getEffectiveUploadLimits` so they're unit-testable without mocking Supabase, matching this repo's existing convention that only pure logic gets automated tests (every prior phase's service-layer DB calls are verified manually, never unit-tested with mocks — the one existing exception, `profiles.test.ts`, mocks Supabase clients directly rather than treating this as a hard rule, so that pattern remains available where a test's value clearly justifies it, as in §7's rewritten avatar tests).

## 5. Non-admin-gated settings read (`lib/services/admin-settings.ts`, modified)

One new export, alongside the existing admin-only `getAllPlatformSettings`/`updatePlatformSettings` (both untouched):

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

## 6. Seed-data correction (new migration)

Plain `update` statements — not the `update_platform_setting` RPC, which requires `auth.uid()` and would raise `FORBIDDEN` with no authenticated caller in a migration:

```sql
update public.platform_settings
set value = '20'
where key = 'max_upload_size_mb';

update public.platform_settings
set value = '["image/jpeg", "image/png", "image/webp", "video/mp4", "application/pdf"]'
where key = 'allowed_file_types';
```

Without this, turning on enforcement against today's actual seeded values (5MB, no PDF) would immediately regress real, currently-working uploads: job completion evidence (today allows up to 20MB video) would clip to 5MB, and KTP/payment-proof/withdrawal-proof/refund-proof (today all allow PDF) would reject every PDF. 20MB and the union of every context's allowed types is the minimum change that preserves current real-world behavior unchanged on day one — an admin can still tighten either value afterward through the existing settings page, same as before.

## 7. Wiring into the 5 already-server-validated actions

`app/(main)/verification/actions.ts`, `app/(main)/jobs/[id]/payment/actions.ts`, `app/(main)/jobs/[id]/completion/actions.ts`, `app/admin/withdrawals/[id]/actions.ts`, `app/admin/payments/actions.ts`: each drops its local `MAX_FILE_SIZE_BYTES`/`ALLOWED_TYPES` constants and its two `if` checks, replaced by:

```ts
const limits = await getEffectiveUploadLimits('ktp') // context name varies per file
const validationError = validateUploadedFile(file, limits)
if (validationError) {
  return { errors: { file: [validationError] } }
}
```

(`jobEvidence`, `paymentProof`, `withdrawalProof`, `refundProof` for the other four — see §2's table for which context name maps to which file.) No other change to any of these five files — the existing "file is missing entirely" check (`!(file instanceof File) || file.size === 0`) stays exactly as it is, ahead of the new limits check.

## 8. Avatar upload becomes server-validated

**`lib/services/profiles.ts`** — `updateOwnAvatar` changes signature from `(path: string)` to `(file: File)`:

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

The path is now built by the server from the authenticated user's own id — never supplied by the client — so the existing `isOwnFolder` path-validation block is deleted entirely, not just bypassed: forging a path is now structurally impossible rather than merely checked. The upload itself uses the auth-context client (`@/lib/supabase/server`), matching the pattern every other upload type already uses (e.g. `submitEmployerVerification` in the same file's sibling service) and relying on the same pre-existing `avatars_insert_own_folder` storage policy (`(storage.foldername(name))[1] = auth.uid()::text`) that already governs today's browser-side upload — unchanged, since the same authenticated session now performs the upload from the server instead of the browser. `getPublicUrl` + the `profiles` update keep using `createServiceClient()`, unchanged from today (no RLS UPDATE policy exists on `profiles` for the authenticated role at all — every profile write in this file already goes through the service client).

**`app/(main)/profile/actions.ts`** — `updateAvatarAction` takes `FormData` instead of a path string:

```ts
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

**`app/(main)/profile/avatar-uploader.tsx`** — stops importing the browser Supabase client and uploading directly. Keeps a client-side pre-check purely for instant UX feedback (same values as today, kept as a local constant duplicated in this file — not imported from `lib/upload-limits.ts`, which is `'server-only'` and cannot be imported into a `'use client'` file at all), but submits a `FormData` to the Server Action:

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

(This JSX is unchanged from today's file, reproduced in full here since only the imports, constants, and `handleFileChange` above it change.)

The `userId` prop is removed (the server now derives the path from the authenticated session, never from a client-supplied value) — its caller, `app/(main)/profile/page.tsx`, drops the `userId={profile.id}` prop accordingly.

## 9. Error handling

| Situation | Behavior |
| --- | --- |
| Wrong file type | `validateUploadedFile` returns a message naming the *actual effective* allowed types (post-intersection), not a stale hardcoded list |
| Oversized file | Message states the *actual effective* MB ceiling (post-min), not a stale hardcoded number |
| Admin configures `allowed_file_types` with zero overlap with a context's own set | `validateUploadedFile` falls back to "Tidak ada format file yang diizinkan Admin untuk unggahan ini." — accepted admin-misconfiguration consequence (§3), not a bug |
| A Server Action is invoked directly (bypassing the UI) with no session | `getUploadSettings()`'s RLS-scoped read returns zero rows (not an error — RLS silently filters), so `maxUploadSizeMb`/`allowedFileTypes` fall back to this function's own defaults (5, `[]`); the empty-types case above fires before the underlying service function's own `UNAUTHENTICATED` check is ever reached. Still a full rejection either way — just a different message/order for an already-illegitimate direct call, not a security gap. Accepted, not fixed. |

## 10. Testing

- **`lib/upload-limits.test.ts`** (new): needs `vi.mock('server-only', () => ({}))` at the top, same as `profiles.test.ts` already does, since the module under test starts with `import 'server-only'`. Unit tests for `computeEffectiveLimits` (platform value below/above/equal to the context ceiling; type intersection; empty-intersection edge case) and `validateUploadedFile` (accepts a valid file; rejects wrong type with the effective types named in the message; rejects oversized file with the effective MB in the message; empty-allowed-types fallback message). Neither function touches `getUploadSettings`/Supabase, so no other mocking is needed.
- **`lib/services/profiles.test.ts`**: the existing `updateOwnAvatar` describe block (7 tests, all exercising the now-deleted client-supplied-path validation) is rewritten, not extended, for the new `File`-based signature — mocking both `@/lib/supabase/server`'s `createClient` (the new storage upload call) and the existing `createServiceClient` mock (getPublicUrl + profiles update), covering: happy path (uploads to a path scoped to the authenticated user's own id, updates `profiles`, returns the URL), a storage upload failure surfacing as `INTERNAL_ERROR`, and an unauthenticated caller rejected with `UNAUTHENTICATED` before any storage call. The path-traversal-specific tests are removed outright — the attack surface they exercised (a client-supplied path) no longer exists in this function's signature.
- No automated tests for the 5 wired-up Server Actions themselves (Supabase-dependent, matches every prior phase's convention) — verified via a manual DoD walkthrough: edit `/admin/settings` to tighten `allowed_file_types` (remove a type) and confirm a previously-valid upload of that type is now rejected with a message naming only the remaining allowed types; tighten `max_upload_size_mb` below a context's own ceiling and confirm an oversized-but-previously-valid file is now rejected with the tightened MB in the message; restore the defaults afterward; confirm avatar upload round-trips end-to-end through the new Server Action with a real image file and the visible avatar actually updates.

## 11. Open assumptions

- **The seed-data migration (§6) is a one-time correction, not a recurring need.** Future admin edits to these two settings are the admin's own responsibility to keep sane (§3) — this phase doesn't add any safeguard against an admin later setting a value that breaks something.
- **`getUploadSettings()` and `getAllPlatformSettings()` intentionally read the same table with separate queries** rather than one sharing the other — `getAllPlatformSettings()` stays admin-gated and reads all 6 keys for the settings page; `getUploadSettings()` is ungated and reads only the 2 keys every upload path needs. Not worth merging into one parameterized function for two three-line queries.
- **No caching of `getUploadSettings()` across the 6 call sites within a single request.** Each upload action calls it independently; this is one extra lightweight `platform_settings` SELECT per upload submission, not per page load — judged not worth introducing `React.cache` or similar for.
