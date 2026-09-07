# Phase 2 — Auth & Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registration (with email confirmation), login, logout, and a working profile view/edit page with avatar upload — the first real user-facing features, built entirely on top of Phase 1's schema, RLS, and service-role DAL pattern.

**Architecture:** Registration/login/logout are thin Server Actions calling Supabase Auth directly (no custom DAL needed — Supabase Auth's own API is already the trusted server-side boundary once called from inside `'use server'`). Profile reads/writes are different: because `profiles`' sensitive columns (`phone`, `address`, `latitude`, `longitude`, `account_status`) had their `SELECT`/`UPDATE` grants revoked from the `authenticated` Postgres role in Phase 1 (to close the PII-exposure hole found in that phase's final review), **reading or writing your OWN full profile now requires the service-role client**, not the regular session-scoped one — this is a deliberate consequence of Phase 1's fix, not a new relaxation. Avatar upload is the one place a browser client talks to Supabase directly (the `avatars` bucket's RLS was built in Phase 1 specifically for this), followed by a small Server Action that updates the DB pointer through the service-role client.

**Tech Stack:** Next.js 16 (Server Actions, `useActionState`, native `<form>`), Zod v4 for validation (no React Hook Form — these forms are 2-5 simple fields each; native `useActionState` + Zod, per Next.js's own recommended pattern, covers this without adding a dependency), Supabase Auth (`@supabase/ssr`), Vitest.

**Spec:** `docs/PRD — PARUH WAKTU MVP.md`, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md`, and this repo's own Phase 1 plan (`docs/superpowers/plans/2026-09-07-phase-1-foundation-database.md`) for the schema/RLS this phase builds on.

## Global Constraints

- Every Server Action re-verifies authentication/authorization inside itself — never rely on `proxy.ts`'s redirect alone (established in Phase 1, still applies).
- Reading or writing any `profiles` column beyond `id, full_name, avatar_url, created_at, updated_at` — for ANY user, including the caller's own row — requires `lib/supabase/service.ts`'s service-role client. The regular `authenticated`-role client (browser or server) cannot see or change `phone`/`address`/`latitude`/`longitude`/`account_status` at all; this is enforced by a Postgres column-level grant, not just RLS.
- All Zod schemas use Zod v4 syntax (top-level `z.email()`, `error` option — not the deprecated `message`/`invalid_type_error` params).
- Email confirmation stays **enabled** (Supabase's own hosted-project default) — this phase does not disable it. A safest-MVP-assumption per Section 58: requiring a real, clickable email address before granting access is the more defensible default for a marketplace handling money and home addresses.
- File uploads (avatars) validate file type and size **client-side for UX** and rely on the bucket's own `file_size_limit`/`allowed_mime_types` (set in Phase 1) as the real enforcement boundary — never trust the client-side check alone.
- No mass assignment: `updateOwnProfile` explicitly whitelists `full_name`/`phone`/`address` — it must never accept or write `account_status`, `id`, or any other column, even if a caller's input object happens to contain one.
- Routes live at the real `/auth/*` URL segment (`app/auth/login`, `app/auth/register`, `app/auth/confirm`), not a parenthesized `(auth)` route group — `lib/supabase/middleware.ts`'s existing public-path check (`pathname.startsWith('/auth')`) and its login-redirect target (`/auth/login`) already assume this; using a route group would silently break both without any code touching them.
- Latitude/longitude are deliberately **not** exposed in this phase's profile-edit UI. Collecting precise GPS coordinates via a bare number input is poor UX for a feature whose whole point is a map picker (Leaflet + OpenStreetMap, Section 14) — that component doesn't exist until the Location phase. The database columns already exist (Phase 1); this phase's `updateOwnProfile` simply doesn't touch them yet.

---

### Task 1: Validation schemas (Zod) for auth and profile forms

**Files:**
- Create: `lib/validations/auth.ts`
- Create: `lib/validations/auth.test.ts`
- Create: `lib/validations/profile.ts`
- Create: `lib/validations/profile.test.ts`
- Modify: `.env.local` (add `NEXT_PUBLIC_SITE_URL`)

**Interfaces:**
- Produces: `RegisterSchema`, `RegisterFormState`, `LoginSchema`, `LoginFormState` (from `lib/validations/auth.ts`); `UpdateProfileSchema`, `UpdateProfileFormState` (from `lib/validations/profile.ts`) — consumed by every Server Action in Tasks 3–6.

- [ ] **Step 1: Install Zod**

```bash
npm install zod
```

- [ ] **Step 2: Add `NEXT_PUBLIC_SITE_URL` to `.env.local`**

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

(This is a `NEXT_PUBLIC_` var — it's not a secret, just the app's own base URL, used to build the email-confirmation redirect link in Task 2.)

- [ ] **Step 3: Write the failing tests for `RegisterSchema`/`LoginSchema`**

Create `lib/validations/auth.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { LoginSchema, RegisterSchema } from './auth'

describe('RegisterSchema', () => {
  const valid = {
    fullName: 'Budi Santoso',
    email: 'budi@example.com',
    phone: '081234567890',
    password: 'password1',
    confirmPassword: 'password1',
  }

  it('accepts valid input', () => {
    expect(RegisterSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a password without a number', () => {
    const result = RegisterSchema.safeParse({
      ...valid,
      password: 'passwordonly',
      confirmPassword: 'passwordonly',
    })
    expect(result.success).toBe(false)
  })

  it('rejects mismatched confirmPassword', () => {
    const result = RegisterSchema.safeParse({
      ...valid,
      confirmPassword: 'different1',
    })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = RegisterSchema.safeParse({ ...valid, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects a phone number that is too short', () => {
    const result = RegisterSchema.safeParse({ ...valid, phone: '123' })
    expect(result.success).toBe(false)
  })
})

describe('LoginSchema', () => {
  it('accepts valid input', () => {
    expect(
      LoginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success
    ).toBe(true)
  })

  it('rejects an empty password', () => {
    expect(
      LoginSchema.safeParse({ email: 'a@b.com', password: '' }).success
    ).toBe(false)
  })

  it('rejects an invalid email', () => {
    expect(
      LoginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 4: Run it and confirm it fails**

```bash
npx vitest run lib/validations/auth.test.ts
```

Expected: FAIL — `Cannot find module './auth'`.

- [ ] **Step 5: Implement `RegisterSchema`/`LoginSchema`**

Create `lib/validations/auth.ts`:

```ts
import { z } from 'zod'

export const RegisterSchema = z
  .object({
    fullName: z.string().min(2, { error: 'Nama minimal 2 karakter.' }).trim(),
    email: z.email({ error: 'Masukkan alamat email yang valid.' }).trim(),
    phone: z
      .string()
      .regex(/^\+?[0-9\s-]{8,15}$/, {
        error: 'Masukkan nomor telepon yang valid (8-15 digit).',
      })
      .trim(),
    password: z
      .string()
      .min(8, { error: 'Password minimal 8 karakter.' })
      .regex(/[a-zA-Z]/, { error: 'Password harus mengandung huruf.' })
      .regex(/[0-9]/, { error: 'Password harus mengandung angka.' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    error: 'Konfirmasi password tidak cocok.',
    path: ['confirmPassword'],
  })

export type RegisterFormState =
  | {
      errors?: {
        fullName?: string[]
        email?: string[]
        phone?: string[]
        password?: string[]
        confirmPassword?: string[]
      }
      message?: string
    }
  | undefined

export const LoginSchema = z.object({
  email: z.email({ error: 'Masukkan alamat email yang valid.' }).trim(),
  password: z.string().min(1, { error: 'Password wajib diisi.' }),
})

export type LoginFormState =
  | {
      errors?: {
        email?: string[]
        password?: string[]
      }
      message?: string
    }
  | undefined
```

- [ ] **Step 6: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/auth.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 7: Write the failing tests for `UpdateProfileSchema`**

Create `lib/validations/profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { UpdateProfileSchema } from './profile'

describe('UpdateProfileSchema', () => {
  it('accepts valid input with an address', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: '081234567890',
        address: 'Jl. Merdeka No. 1',
      }).success
    ).toBe(true)
  })

  it('accepts an empty address', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: '081234567890',
        address: '',
      }).success
    ).toBe(true)
  })

  it('rejects a name that is too short', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'B',
        phone: '081234567890',
        address: '',
      }).success
    ).toBe(false)
  })

  it('rejects an invalid phone number', () => {
    expect(
      UpdateProfileSchema.safeParse({
        fullName: 'Budi Santoso',
        phone: 'abc',
        address: '',
      }).success
    ).toBe(false)
  })
})
```

- [ ] **Step 8: Run it and confirm it fails**

```bash
npx vitest run lib/validations/profile.test.ts
```

Expected: FAIL — `Cannot find module './profile'`.

- [ ] **Step 9: Implement `UpdateProfileSchema`**

Create `lib/validations/profile.ts`:

```ts
import { z } from 'zod'

export const UpdateProfileSchema = z.object({
  fullName: z.string().min(2, { error: 'Nama minimal 2 karakter.' }).trim(),
  phone: z
    .string()
    .regex(/^\+?[0-9\s-]{8,15}$/, {
      error: 'Masukkan nomor telepon yang valid (8-15 digit).',
    })
    .trim(),
  address: z
    .string()
    .max(255, { error: 'Alamat maksimal 255 karakter.' })
    .trim()
    .optional()
    .or(z.literal('')),
})

export type UpdateProfileFormState =
  | {
      errors?: {
        fullName?: string[]
        phone?: string[]
        address?: string[]
      }
      message?: string
    }
  | undefined
```

- [ ] **Step 10: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/profile.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 11: Typecheck and full test run**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: no errors; all tests (Phase 1's 8 + this task's 12 = 20) pass.

- [ ] **Step 12: Commit**

```bash
git add lib/validations package.json package-lock.json .env.local
git commit -m "feat: add Zod validation schemas for auth and profile forms"
```

(`.env.local` is git-ignored — if `git add` reports nothing changed for it, that's expected; the commit will just cover the schemas and the Zod dependency.)

---

### Task 2: Email confirmation route + Supabase Dashboard configuration

**Files:**
- Create: `app/auth/confirm/route.ts`

**Interfaces:**
- Produces: a working `GET /auth/confirm?token_hash=...&type=...&next=...` endpoint that Task 3's registration email link points to.
- Consumes: `lib/supabase/server.ts` (Phase 1).

**This task has a manual prerequisite only a human can do** — a subagent cannot click through the Supabase Dashboard. Before (or alongside) implementing the route below, do this in the Supabase Dashboard for project `msvhvkthvwdabwlgmwyi`:

1. **Authentication → URL Configuration**: set **Site URL** to `http://localhost:3000`, and add `http://localhost:3000/**` under **Redirect URLs**. (Update both again once this app has a real deployed domain — this is a dev-only value for now.)
2. **Authentication → Providers → Email**: confirm "Confirm email" is switched **on** (it's the hosted-project default; this step just verifies nobody turned it off).
3. **Authentication → Email Templates → Confirm signup**: replace the template's link/button `href` with:
   ```
   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/profile
   ```
   This is required because this app uses `@supabase/ssr` cookie-based sessions — the default `{{ .ConfirmationURL }}` doesn't set a cookie for *this* app's domain, but the route below (calling `verifyOtp`) does.

- [ ] **Step 1: Confirm the manual dashboard steps above are done**

There's nothing to verify programmatically here (it's dashboard state, not something `supabase db push` touches) — just confirm with whoever has dashboard access before treating Task 3's registration flow as testable end-to-end. The route below can still be written and typechecked regardless.

- [ ] **Step 2: Write the confirmation route handler**

Create `app/auth/confirm/route.ts`:

```ts
import { type EmailOtpType } from '@supabase/supabase-js'
import { redirect } from 'next/navigation'
import { type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/profile'

  if (tokenHash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      redirect(next)
    }
  }

  redirect('/auth/login?error=confirmation_failed')
}
```

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed. (This route isn't reachable end-to-end yet — Task 3 builds the registration flow that emails a link to it.)

- [ ] **Step 4: Commit**

```bash
git add app/auth/confirm
git commit -m "feat(auth): add email confirmation route handler"
```

---

### Task 3: Registration

**Files:**
- Create: `app/auth/actions.ts`
- Create: `app/auth/register/page.tsx`
- Create: `app/auth/register/success/page.tsx`

**Interfaces:**
- Produces: `registerAction(prevState, formData)` Server Action — also consumed by no one else yet, but `app/auth/actions.ts` is where Task 4 adds `loginAction`/`logoutAction` alongside it.
- Consumes: `RegisterSchema`, `RegisterFormState` (Task 1); `lib/supabase/server.ts` (Phase 1).

- [ ] **Step 1: Create the registration Server Action**

Create `app/auth/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  LoginSchema,
  RegisterSchema,
  type LoginFormState,
  type RegisterFormState,
} from '@/lib/validations/auth'

export async function registerAction(
  _prevState: RegisterFormState,
  formData: FormData
): Promise<RegisterFormState> {
  const validatedFields = RegisterSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    password: formData.get('password'),
    confirmPassword: formData.get('confirmPassword'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  const { fullName, email, phone, password } = validatedFields.data
  const supabase = await createClient()

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, phone },
      emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/profile`,
    },
  })

  if (error) {
    return { message: 'Pendaftaran gagal. Email mungkin sudah terdaftar.' }
  }

  redirect('/auth/register/success')
}
```

Note: `redirect()` throws internally by design — do not wrap the `redirect()` call in a `try`/`catch`.

- [ ] **Step 2: Create the registration page**

Create `app/auth/register/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { registerAction } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function RegisterPage() {
  const [state, action, pending] = useActionState(registerAction, undefined)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-xl font-semibold">Daftar Akun</h1>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">Nama Lengkap</Label>
          <Input id="fullName" name="fullName" required />
          {state?.errors?.fullName && (
            <p className="text-sm text-destructive">{state.errors.fullName[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
          {state?.errors?.email && (
            <p className="text-sm text-destructive">{state.errors.email[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Nomor Telepon</Label>
          <Input id="phone" name="phone" type="tel" required />
          {state?.errors?.phone && (
            <p className="text-sm text-destructive">{state.errors.phone[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
          {state?.errors?.password && (
            <p className="text-sm text-destructive">{state.errors.password[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Konfirmasi Password</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" required />
          {state?.errors?.confirmPassword && (
            <p className="text-sm text-destructive">
              {state.errors.confirmPassword[0]}
            </p>
          )}
        </div>
        {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Memproses...' : 'Daftar'}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Sudah punya akun?{' '}
        <Link href="/auth/login" className="text-primary underline-offset-4 hover:underline">
          Masuk
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Create the "check your email" success page**

Create `app/auth/register/success/page.tsx`:

```tsx
import Link from 'next/link'

export default function RegisterSuccessPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Periksa Email Anda</h1>
      <p className="text-sm text-muted-foreground">
        Kami telah mengirimkan tautan konfirmasi ke email Anda. Silakan klik
        tautan tersebut untuk mengaktifkan akun Anda.
      </p>
      <Link
        href="/auth/login"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Kembali ke halaman masuk
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/auth
git commit -m "feat(auth): add registration flow"
```

---

### Task 4: Login and logout

**Files:**
- Modify: `app/auth/actions.ts` (add `loginAction`, `logoutAction`)
- Create: `app/auth/login/page.tsx`

**Interfaces:**
- Produces: `loginAction(prevState, formData)`, `logoutAction()` — the latter consumed by Task 6's profile page.
- Consumes: `LoginSchema`, `LoginFormState` (Task 1).

- [ ] **Step 1: Add `loginAction` and `logoutAction`**

Edit `app/auth/actions.ts`, adding these two exports after `registerAction` (the existing `'use server'` directive, imports — extended with `LoginSchema`/`LoginFormState`, already shown in Task 3 — and `registerAction` stay as they are):

```ts
export async function loginAction(
  _prevState: LoginFormState,
  formData: FormData
): Promise<LoginFormState> {
  const validatedFields = LoginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(validatedFields.data)

  if (error) {
    return { message: 'Email atau password salah.' }
  }

  redirect('/profile')
}

export async function logoutAction() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/auth/login')
}
```

- [ ] **Step 2: Create the login page**

Create `app/auth/login/page.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-xl font-semibold">Masuk</h1>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
          {state?.errors?.email && (
            <p className="text-sm text-destructive">{state.errors.email[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
          {state?.errors?.password && (
            <p className="text-sm text-destructive">{state.errors.password[0]}</p>
          )}
        </div>
        {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Memproses...' : 'Masuk'}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Belum punya akun?{' '}
        <Link href="/auth/register" className="text-primary underline-offset-4 hover:underline">
          Daftar
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add app/auth
git commit -m "feat(auth): add login and logout"
```

---

### Task 5: Profile Data Access Layer

**Files:**
- Create: `lib/services/profiles.ts`

**Interfaces:**
- Produces: `OwnProfile` (interface), `getOwnProfile()`, `UpdateProfileInput` (interface), `updateOwnProfile(input)`, `updateOwnAvatar(path)` — all consumed by Task 6 (profile page + form action) and Task 7 (avatar upload action).
- Consumes: `getCurrentUser` (Phase 1's `lib/auth/get-current-user.ts`), `createServiceClient` (Phase 1's `lib/supabase/service.ts`), `appError` (Phase 1's `lib/errors.ts`), `UpdateProfileSchema` (Task 1).

- [ ] **Step 1: Write the service layer**

Create `lib/services/profiles.ts`:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { UpdateProfileSchema } from '@/lib/validations/profile'

export interface OwnProfile {
  id: string
  fullName: string
  phone: string | null
  avatarUrl: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  accountStatus: string
}

export async function getOwnProfile(): Promise<OwnProfile> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, phone, avatar_url, address, latitude, longitude, account_status'
    )
    .eq('id', user.id)
    .single()

  if (error || !data) {
    throw appError('NOT_FOUND', 'Profil tidak ditemukan.')
  }

  return {
    id: data.id,
    fullName: data.full_name,
    phone: data.phone,
    avatarUrl: data.avatar_url,
    address: data.address,
    latitude: data.latitude,
    longitude: data.longitude,
    accountStatus: data.account_status,
  }
}

export interface UpdateProfileInput {
  fullName: string
  phone: string
  address?: string
}

export async function updateOwnProfile(input: UpdateProfileInput): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const validated = UpdateProfileSchema.parse(input)

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: validated.fullName,
      phone: validated.phone,
      address: validated.address || null,
    })
    .eq('id', user.id)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
}

export async function updateOwnAvatar(path: string): Promise<string> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  if (!path.startsWith(`${user.id}/`)) {
    throw appError('FORBIDDEN', 'Anda hanya dapat mengubah avatar Anda sendiri.')
  }

  const supabase = createServiceClient()
  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path)
  const avatarUrl = publicUrlData.publicUrl

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return avatarUrl
}
```

Note on `updateOwnAvatar`'s ownership check: the `avatars` bucket's Phase 1 RLS policy already restricts uploads to the caller's own folder (`avatars/{user_id}/...`), and `storage.objects.name` is stored *relative to the bucket* — so a path like `"<uuid>/1699999999-photo.jpg"` has the user id as its first segment, matching the `path.startsWith(`${user.id}/`)` check above. This check exists so a malicious client can't claim a path string outside their own folder as their new avatar, even though RLS already stopped them from having actually uploaded there.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. (No UI consumes this yet — that's Tasks 6 and 7. This is service-layer code with no automated test here because every path requires a real authenticated session and a real Supabase connection; it's exercised end-to-end once Task 6/7's UI exists, verified manually against the dev server per Task 8.)

- [ ] **Step 3: Commit**

```bash
git add lib/services
git commit -m "feat(profile): add profile data access layer"
```

---

### Task 6: Profile page (view and edit)

**Files:**
- Create: `app/profile/page.tsx`
- Create: `app/profile/actions.ts`
- Create: `app/profile/profile-form.tsx`

**Interfaces:**
- Consumes: `getOwnProfile`, `updateOwnProfile`, `OwnProfile` (Task 5); `UpdateProfileSchema`, `UpdateProfileFormState` (Task 1); `logoutAction` (Task 4); `toSafeErrorMessage` (Phase 1's `lib/errors.ts`).
- Produces: `updateProfileAction(prevState, formData)` — also consumed by Task 7 (same `app/profile/actions.ts` file gets `updateAvatarAction` added there).

- [ ] **Step 1: Create the profile Server Action**

Create `app/profile/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { updateOwnProfile } from '@/lib/services/profiles'
import { UpdateProfileSchema, type UpdateProfileFormState } from '@/lib/validations/profile'
import { toSafeErrorMessage } from '@/lib/errors'

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
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/profile')
  return { message: 'Profil berhasil diperbarui.' }
}
```

- [ ] **Step 2: Create the profile form (client component)**

Create `app/profile/profile-form.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { updateProfileAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OwnProfile } from '@/lib/services/profiles'

export function ProfileForm({ profile }: { profile: OwnProfile }) {
  const [state, action, pending] = useActionState(updateProfileAction, undefined)

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullName">Nama Lengkap</Label>
        <Input id="fullName" name="fullName" defaultValue={profile.fullName} required />
        {state?.errors?.fullName && (
          <p className="text-sm text-destructive">{state.errors.fullName[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Nomor Telepon</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={profile.phone ?? ''}
          required
        />
        {state?.errors?.phone && (
          <p className="text-sm text-destructive">{state.errors.phone[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Alamat</Label>
        <Input id="address" name="address" defaultValue={profile.address ?? ''} />
        {state?.errors?.address && (
          <p className="text-sm text-destructive">{state.errors.address[0]}</p>
        )}
      </div>
      {state?.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan Perubahan'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Create the profile page (server component)**

Create `app/profile/page.tsx`:

```tsx
import { getOwnProfile } from '@/lib/services/profiles'
import { logoutAction } from '@/app/auth/actions'
import { ProfileForm } from './profile-form'
import { Button } from '@/components/ui/button'

export default async function ProfilePage() {
  const profile = await getOwnProfile()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profil Saya</h1>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Keluar
          </Button>
        </form>
      </div>
      <ProfileForm profile={profile} />
    </div>
  )
}
```

(The avatar uploader slots in above `<ProfileForm profile={profile} />` in Task 7 — this task deliberately ships the page without it first, so the view/edit flow can be verified on its own.)

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/profile
git commit -m "feat(profile): add profile view/edit page"
```

---

### Task 7: Avatar upload

**Files:**
- Create: `app/profile/avatar-uploader.tsx`
- Modify: `app/profile/actions.ts` (add `updateAvatarAction`)
- Modify: `app/profile/page.tsx` (render `<AvatarUploader>`)

**Interfaces:**
- Consumes: `updateOwnAvatar` (Task 5); `lib/supabase/client.ts` (Phase 1, for the direct browser upload); `toSafeErrorMessage` (Phase 1).
- Produces: `updateAvatarAction(path)`.

- [ ] **Step 1: Add `updateAvatarAction`**

Edit `app/profile/actions.ts`, adding this export (and extending the existing imports with `updateOwnAvatar`):

```ts
import { updateOwnAvatar, updateOwnProfile } from '@/lib/services/profiles'

// ...(updateProfileAction stays as-is)...

export async function updateAvatarAction(path: string) {
  try {
    const avatarUrl = await updateOwnAvatar(path)
    revalidatePath('/profile')
    return { success: true as const, avatarUrl }
  } catch (error) {
    return { success: false as const, message: toSafeErrorMessage(error) }
  }
}
```

- [ ] **Step 2: Create the avatar uploader (client component)**

Create `app/profile/avatar-uploader.tsx`:

```tsx
'use client'

import { useRef, useState, useTransition, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateAvatarAction } from './actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function AvatarUploader({
  userId,
  currentAvatarUrl,
}: {
  userId: string
  currentAvatarUrl: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Format file harus JPEG, PNG, atau WebP.')
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('Ukuran file maksimal 5MB.')
      return
    }

    startTransition(async () => {
      const supabase = createClient()
      const path = `${userId}/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })

      if (uploadError) {
        setError('Gagal mengunggah avatar. Silakan coba lagi.')
        return
      }

      const result = await updateAvatarAction(path)
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

- [ ] **Step 3: Wire it into the profile page**

Edit `app/profile/page.tsx` — add the import and render it above `<ProfileForm>`:

```tsx
import { getOwnProfile } from '@/lib/services/profiles'
import { logoutAction } from '@/app/auth/actions'
import { AvatarUploader } from './avatar-uploader'
import { ProfileForm } from './profile-form'
import { Button } from '@/components/ui/button'

export default async function ProfilePage() {
  const profile = await getOwnProfile()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profil Saya</h1>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Keluar
          </Button>
        </form>
      </div>
      <AvatarUploader userId={profile.id} currentAvatarUrl={profile.avatarUrl} />
      <ProfileForm profile={profile} />
    </div>
  )
}
```

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/profile
git commit -m "feat(profile): add avatar upload"
```

---

### Task 8: Phase 2 Definition-of-Done verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be Phase 1's 8 + Task 1's 12 = 20.

- [ ] **Step 2: Create a pre-confirmed test user for manual verification**

Since real end-to-end registration requires clicking a link in a real inbox, create one throwaway, already-confirmed test user via the Auth Admin API so the login → profile → avatar → logout path can be checked without needing real email access. Run this as a one-off Node script (do not commit it):

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
  email: 'phase2-verify@example.com',
  password: 'password1',
  email_confirm: true,
  user_metadata: { full_name: 'Phase 2 Verifier', phone: '081200000000' },
}).then(({ data, error }) => console.log(JSON.stringify({ data, error }, null, 2)));
"
```

If `dotenv` isn't available, load the three env vars manually instead (`export $(grep -v '^#' .env.local | xargs)` before the `node -e` call) rather than adding `dotenv` as a project dependency for a one-off script.

Expected: prints a created user object with no error. Note the user's `id` from the output — you'll want it if you need to delete this test user afterward via `supabase.auth.admin.deleteUser(id)`.

- [ ] **Step 3: Start the dev server and verify the flow in a real browser**

```bash
npm run dev
```

Using a real browser (not curl — this is a UI flow), verify:
1. Visiting `/profile` while logged out redirects to `/auth/login` (existing `proxy.ts` behavior from Phase 1, now actually exercised).
2. Log in as `phase2-verify@example.com` / `password1` at `/auth/login` → redirects to `/profile`.
3. The profile page shows "Phase 2 Verifier" and the phone number pre-filled.
4. Edit the name, submit, confirm the success message appears and the new name persists after a refresh.
5. Upload an avatar image (any small JPEG/PNG) — confirm it appears immediately without a page reload.
6. Click "Keluar" (logout) — confirm you're redirected to `/auth/login` and `/profile` is no longer accessible without logging in again.
7. Separately, if the Task 2 dashboard configuration is in place: register a **new** account with a real email address you control at `/auth/register`, confirm the "check your email" page appears, then actually click the confirmation link in the email and confirm it lands you on `/profile` logged in.

- [ ] **Step 4: Clean up the test user**

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
  const user = data.users.find(u => u.email === 'phase2-verify@example.com');
  if (user) return supabase.auth.admin.deleteUser(user.id).then(() => console.log('deleted', user.id));
  console.log('no test user found');
});
"
```

- [ ] **Step 5: Report results**

If every check in Step 3 passes, Phase 2 is functionally complete. If the manual dashboard configuration (Task 2) hasn't been done yet, checks 1–6 can still all be verified (they don't depend on it) — only check 7 (real email confirmation) needs it; note clearly which checks passed and which are still blocked on that manual step.

## Phase 2 Definition of Done

- [ ] Registration creates a Supabase Auth user + triggers Phase 1's `handle_new_user()` (profile + default `worker` role) via `raw_user_meta_data`.
- [ ] Email confirmation is required and the `/auth/confirm` route correctly exchanges the token for a session.
- [ ] Login and logout work and correctly redirect.
- [ ] `/profile` is inaccessible while logged out (verified via the browser, not just code review).
- [ ] Profile view shows name/phone/address; edit persists changes through the service-role DAL.
- [ ] Avatar upload works end-to-end (client upload to storage → DB pointer update) and appears without a page reload.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
