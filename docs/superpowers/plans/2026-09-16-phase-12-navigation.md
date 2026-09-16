# Phase 12 (In-App Navigation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app a real, shared in-app navigation surface — a bottom tab bar for the regular user-facing app and a sidebar for the admin panel — so every route that today is reachable only by typing a URL (all of `/admin/*` including the dashboard, plus `/wallet` and `/chat`) becomes reachable by clicking.

**Architecture:** A new `app/(main)/` route group wraps the six existing user-facing route folders (`jobs`, `applications`, `chat`, `wallet`, `profile`, `verification`) with a layout that renders a client-side bottom tab bar for logged-in users. `app/admin/layout.tsx` (already an auth guard, currently rendering nothing else) gains a client-side sidebar the same way. Both nav components read only `usePathname()` for active-state highlighting — no new data fetching, no new RPCs, no schema changes. The root `app/page.tsx` becomes a pure server-side redirect based on `getCurrentUser()`.

**Tech Stack:** Next.js 16.3.4 (Server Components for layouts, `'use client'` components for the two nav bars), Tailwind CSS + `lucide-react` (existing dependency, no new packages), Playwright (already installed on this machine for prior phases' DoD verification — reuse it, don't reinstall).

**Spec:** `docs/superpowers/specs/2026-09-16-navigation-design.md`

## Global Constraints

- Presentation-only phase: no new RPCs, no schema changes, no new auth gate beyond what each page already enforces today (spec §2, §6).
- The bottom tab bar has exactly 5 tabs — Jobs (`/jobs`), Applications (`/applications/mine`), Chat (`/chat`), Wallet (`/wallet`), Profile (`/profile`) — identical for every logged-in user regardless of role. No role-adaptive tabs, no unread-count badge (spec §2, §3.3).
- The admin sidebar has exactly the 9 links in PRD §32-40 order (Dashboard, Pengguna, Verifikasi Employer, Pekerjaan, Pembayaran, Withdrawal, Kategori, Pengaturan, Audit Log) plus one "Kembali ke Aplikasi" link to `/jobs` (spec §4, §8).
- No new shadcn/Radix primitive for the admin sidebar's mobile collapse — plain Tailwind + local `useState`, matching spec §2.
- Dashboard tiles link to an exact-filter URL only where the target page already supports that exact filter (`/admin/users?role=worker`, `/admin/users?role=employer`, `/admin/jobs?status=completed`); every other tile links to the plain unfiltered list. Do not add new filter support to `/admin/payments` or `/admin/withdrawals` (spec §5).
- The `app/(main)/` folder move is a pure `git mv` relocation — no logic, import, or auth-check change to any moved file (spec §8).
- No new automated tests: this phase adds no new validation schema or business logic (unlike every prior phase's `lib/validations/*.test.ts` addition) — verification is the manual DoD walkthrough in Task 6, matching spec §7.

---

### Task 1: Root route redirect

**Files:**
- Modify: `app/page.tsx` (full rewrite)
- Delete: `public/next.svg`, `public/vercel.svg` (orphaned — the only file referencing them is being replaced)

**Interfaces:**
- Consumes: `getCurrentUser()` (`lib/auth/get-current-user.ts`, unchanged).

- [ ] **Step 1: Rewrite `app/page.tsx`**

Replace the entire file (the current `create-next-app` boilerplate) with:

```tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export default async function Home() {
  const user = await getCurrentUser()
  redirect(user ? '/jobs' : '/auth/login')
}
```

- [ ] **Step 2: Remove the now-orphaned boilerplate images**

```bash
git rm public/next.svg public/vercel.svg
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
npm run typecheck
npx eslint .
npm run build
```

Expected: all clean. `/` should no longer appear as a static route in the build output's route list — it becomes dynamic (ƒ), since it now calls `getCurrentUser()`.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx public/next.svg public/vercel.svg
git commit -m "feat(nav): replace boilerplate root page with an auth-based redirect"
```

---

### Task 2: `(main)` route group, layout, and bottom tab bar

**Files:**
- Move: `app/jobs/` → `app/(main)/jobs/`, `app/applications/` → `app/(main)/applications/`, `app/chat/` → `app/(main)/chat/`, `app/wallet/` → `app/(main)/wallet/`, `app/profile/` → `app/(main)/profile/`, `app/verification/` → `app/(main)/verification/`
- Create: `app/(main)/layout.tsx`, `components/shared/bottom-nav.tsx`

**Interfaces:**
- Consumes: `getCurrentUser()` (`lib/auth/get-current-user.ts`).
- Produces: `BottomNav` component (`components/shared/bottom-nav.tsx`, default export none — named export `BottomNav`) — consumed only by `app/(main)/layout.tsx` in this same task.
- Produces (relocation only): every route under the six moved folders now lives at `app/(main)/<folder>/...` on disk, with the same URL as before (route groups don't affect URLs) — Task 3 depends on `app/(main)/profile/page.tsx` existing at its new path.

- [ ] **Step 1: Move the six route folders into a new route group**

```bash
mkdir -p "app/(main)"
git mv app/jobs "app/(main)/jobs"
git mv app/applications "app/(main)/applications"
git mv app/chat "app/(main)/chat"
git mv app/wallet "app/(main)/wallet"
git mv app/profile "app/(main)/profile"
git mv app/verification "app/(main)/verification"
```

Expected: `git status` shows all 25 files under these folders as renames (`R`), not delete+add. No file's contents change in this step — verify with `git diff --stat HEAD` showing only renames.

- [ ] **Step 2: Create `components/shared/bottom-nav.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, ClipboardList, MessageCircle, Wallet, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavTab {
  href: string
  label: string
  icon: LucideIcon
}

const TABS: NavTab[] = [
  { href: '/jobs', label: 'Pekerjaan', icon: Briefcase },
  { href: '/applications/mine', label: 'Lamaran', icon: ClipboardList },
  { href: '/chat', label: 'Chat', icon: MessageCircle },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/profile', label: 'Profil', icon: User },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background">
      <ul className="mx-auto flex max-w-md items-stretch justify-between">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 text-xs',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

- [ ] **Step 3: Create `app/(main)/layout.tsx`**

```tsx
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { BottomNav } from '@/components/shared/bottom-nav'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 pb-16">{children}</div>
      {user && <BottomNav />}
    </div>
  )
}
```

No `requireRole`/`requireAdminOr404` call here — each page under this group keeps whatever auth behavior it already has; this layout only decides whether the nav bar itself renders.

- [ ] **Step 4: Typecheck, lint, build**

```bash
npm run typecheck
npx eslint .
npm run build
```

Expected: all clean. The build's route list should still show every route that existed before (`/jobs`, `/jobs/[id]`, `/applications/mine`, `/chat`, `/wallet`, `/profile`, `/verification`, etc.) at the same paths — the route group must not appear in any URL.

- [ ] **Step 5: Commit**

```bash
git add "app/(main)" components/shared/bottom-nav.tsx
git commit -m "feat(nav): move user-facing routes into a (main) route group with a bottom tab bar"
```

---

### Task 3: Cross-panel link — Profile → Admin

**Files:**
- Modify: `app/(main)/profile/page.tsx`

**Interfaces:**
- Consumes: `currentUser.roles` (already fetched in this file via `getCurrentUser()`).

- [ ] **Step 1: Compute `isAdmin` alongside the existing `isEmployer`**

In `app/(main)/profile/page.tsx`, right after the existing line:

```ts
const isEmployer = currentUser?.roles.includes('employer') ?? false
```

add:

```ts
const isAdmin = currentUser?.roles.includes('admin') ?? false
```

- [ ] **Step 2: Add the conditional link**

Immediately after the existing `{isEmployer && (...)}` block's closing `)}` and before `<ProfileForm profile={profile} />`, add:

```tsx
{isAdmin && (
  <Link href="/admin" className="text-sm text-primary underline-offset-4 hover:underline">
    Panel Admin
  </Link>
)}
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
npm run typecheck
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(main)/profile/page.tsx"
git commit -m "feat(nav): add Panel Admin link on Profile for admin users"
```

---

### Task 4: Admin sidebar

**Files:**
- Create: `components/admin/admin-sidebar.tsx`
- Modify: `app/admin/layout.tsx`

**Interfaces:**
- Produces: `AdminSidebar` component (`components/admin/admin-sidebar.tsx`, named export `AdminSidebar`) — consumed only by `app/admin/layout.tsx` in this same task.

- [ ] **Step 1: Create `components/admin/admin-sidebar.tsx`**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Briefcase,
  Receipt,
  ArrowLeftRight,
  Tag,
  Settings,
  ScrollText,
  ArrowLeft,
  Menu,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminSection {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

const SECTIONS: AdminSection[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Pengguna', icon: Users },
  { href: '/admin/employer-verifications', label: 'Verifikasi Employer', icon: ShieldCheck },
  { href: '/admin/jobs', label: 'Pekerjaan', icon: Briefcase },
  { href: '/admin/payments', label: 'Pembayaran', icon: Receipt },
  { href: '/admin/withdrawals', label: 'Withdrawal', icon: ArrowLeftRight },
  { href: '/admin/categories', label: 'Kategori', icon: Tag },
  { href: '/admin/settings', label: 'Pengaturan', icon: Settings },
  { href: '/admin/audit-logs', label: 'Audit Log', icon: ScrollText },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  function isActive(section: AdminSection): boolean {
    return section.exact ? pathname === section.href : pathname.startsWith(section.href)
  }

  return (
    <div className="border-b md:w-56 md:flex-shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:hidden">
        <span className="text-sm font-semibold">Admin Panel</span>
        <button type="button" onClick={() => setIsOpen((open) => !open)} aria-label="Buka menu admin">
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      <nav className={cn('flex-col gap-1 p-3 md:flex', isOpen ? 'flex' : 'hidden')}>
        {SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <Link
              key={section.href}
              href={section.href}
              className={cn(
                'flex items-center gap-2 rounded px-3 py-2 text-sm',
                isActive(section) ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </Link>
          )
        })}
        <Link
          href="/jobs"
          className="mt-4 flex items-center gap-2 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Aplikasi
        </Link>
      </nav>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into `app/admin/layout.tsx`**

Replace the file's contents with:

```tsx
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminOr404()

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <AdminSidebar />
      <div className="flex-1">{children}</div>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck, lint, build**

```bash
npm run typecheck
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add components/admin/admin-sidebar.tsx app/admin/layout.tsx
git commit -m "feat(admin): add admin sidebar navigation"
```

---

### Task 5: Admin dashboard tile links

**Files:**
- Modify: `app/admin/page.tsx` (full rewrite — the file is 31 lines)

- [ ] **Step 1: Rewrite `app/admin/page.tsx`**

```tsx
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAdminDashboardStats } from '@/lib/services/admin-dashboard'

export default async function AdminDashboardPage() {
  await requireAdminOr404()
  const stats = await getAdminDashboardStats()

  const tiles: { label: string; value: number; href: string }[] = [
    { label: 'Total Pengguna', value: stats.totalUsers, href: '/admin/users' },
    { label: 'Total Worker', value: stats.totalWorkers, href: '/admin/users?role=worker' },
    { label: 'Total Employer', value: stats.totalEmployers, href: '/admin/users?role=employer' },
    { label: 'Pekerjaan Aktif', value: stats.activeJobs, href: '/admin/jobs' },
    { label: 'Pekerjaan Selesai', value: stats.completedJobs, href: '/admin/jobs?status=completed' },
    { label: 'Pembayaran Menunggu Verifikasi', value: stats.pendingPayments, href: '/admin/payments' },
    { label: 'Withdrawal Menunggu Proses', value: stats.pendingWithdrawals, href: '/admin/withdrawals' },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Dashboard Admin</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="flex flex-col gap-1 rounded border p-4 hover:bg-muted"
          >
            <span className="text-2xl font-semibold">{tile.value}</span>
            <span className="text-sm text-muted-foreground">{tile.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck, lint, build**

```bash
npm run typecheck
npx eslint .
npm run build
```

Expected: all clean.

- [ ] **Step 3: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): link dashboard tiles to their filtered list pages"
```

---

### Task 6: Phase 12 Definition-of-Done verification

**Files:** none (verification only).

**This task must be genuinely executed with a real running app and a real browser (Playwright), not attested to from code review alone.** Playwright + Chromium should already be installed on this machine — do not reinstall; if `require('playwright')` doesn't resolve directly from this worktree's `node_modules`, set `NODE_PATH` to the npx cache directory (find it via `find ~/.npm/_npx -maxdepth 2 -name playwright -type d 2>/dev/null` if unsure).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be unchanged from before this phase (Global Constraints: no new tests added).

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

Leave it running for the rest of this task.

- [ ] **Step 3: Verify the root redirect**

Via Playwright, with no session cookie: navigate to `/` — confirm it lands on `/auth/login`. Log in as any existing worker test account, then navigate to `/` again — confirm it lands on `/jobs`.

- [ ] **Step 4: Verify the bottom tab bar for a worker-only account**

Signed in as a worker-only account (create one via the same `auth.admin.createUser` + `user_roles` pattern used in every prior phase's verification if none exists): confirm the bottom bar is visible and shows exactly 5 tabs (Pekerjaan, Lamaran, Chat, Wallet, Profil) on `/jobs`, `/applications/mine`, `/chat`, `/wallet`, and `/profile`. Click each tab from a different starting tab and confirm it navigates to the right route and highlights as active. Navigate to `/jobs/[id]` for any real job id and confirm the Pekerjaan tab still highlights as active there. Confirm `/profile` does **not** show a "Panel Admin" link for this account.

- [ ] **Step 5: Verify a worker+employer account**

Signed in as an account with both `worker` and `employer` roles and an approved employer verification: confirm the bottom bar still shows exactly the same 5 tabs (no 6th tab appears), and that `/profile` still shows the pre-existing "Buat Pekerjaan" / "Pekerjaan Saya" links unaffected by this phase's changes.

- [ ] **Step 6: Verify the admin sidebar and cross-panel links**

Signed in as an account with the `admin` role (also holding `worker`, to exercise the cross-panel link): confirm `/profile` shows a "Panel Admin" link that navigates to `/admin`. On `/admin`, confirm the sidebar shows all 9 links in the order specified in Global Constraints, each navigating to its correct route with the correct one highlighted as active on that route (including that `/admin` itself — not any sub-route — highlights only "Dashboard"). Confirm "Kembali ke Aplikasi" navigates to `/jobs`. Resize the browser viewport below the `md` breakpoint (e.g. 375px wide) and confirm the sidebar collapses behind a toggle button that shows/hides the link list on click.

- [ ] **Step 7: Verify the admin dashboard tiles**

On `/admin`, click each of the 7 stat tiles and confirm each lands on the href specified in Task 5's table (`/admin/users`, `/admin/users?role=worker`, `/admin/users?role=employer`, `/admin/jobs`, `/admin/jobs?status=completed`, `/admin/payments`, `/admin/withdrawals`), and that the `?role=`/`?status=` variants actually narrow the list on those two pages that support the param (`/admin/users`, `/admin/jobs`).

- [ ] **Step 8: Verify no nav appears where it shouldn't**

Confirm `/auth/login` and `/auth/register` render with no bottom tab bar. Confirm a logged-out visit to `/jobs` (if reachable at all — it has no page-level auth check of its own) shows no bottom tab bar, matching the pre-existing behavior of there never having been a nav bar before this phase.

- [ ] **Step 9: Clean up any test accounts created for this verification**

If new test accounts were created in Step 4/5/6, delete them (`auth.users` cascades to `profiles`/`user_roles`) to leave no leftover data.

- [ ] **Step 10: Report results**

Note clearly which of Steps 3-8's checks passed, with what was actually observed (not just "pass") — mirroring every prior phase's verification report format. If any fail, do not mark Phase 12 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 12 Definition of Done

- [ ] `/` redirects to `/jobs` when logged in and `/auth/login` when logged out.
- [ ] Every route under `jobs/`, `applications/`, `chat/`, `wallet/`, `profile/`, `verification/` still resolves at its original URL after the `(main)` route group move.
- [ ] A bottom tab bar with exactly 5 tabs (Pekerjaan, Lamaran, Chat, Wallet, Profil) appears for every logged-in user on every route in the `(main)` group, correctly highlighting the active tab including on nested routes.
- [ ] `/profile` shows a "Panel Admin" link only for accounts with the `admin` role.
- [ ] The admin sidebar lists and correctly links all 9 admin sections plus "Kembali ke Aplikasi", correctly highlights the active section, and collapses to a toggle below the `md` breakpoint.
- [ ] All 7 admin dashboard tiles are clickable and link to the correct (filtered where supported) list page.
- [ ] No bottom tab bar or admin sidebar appears on `/auth/*` routes.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] Steps 3-8 in Task 6 were genuinely executed via Playwright against the real running app, not attested to from code review.
