# In-App Navigation — Design

## 1. Purpose

Phases 1-11 built every PRD §3 MVP feature, but no phase ever added a shared nav — `app/page.tsx` is still the untouched `create-next-app` boilerplate, `/wallet` and `/chat` have zero incoming links, and every `/admin/*` route (including the dashboard itself) is reachable only by typing the URL. This closes that gap: PRD §43 states the app "harus... memiliki navigasi sederhana" as an explicit UX requirement, and the §49 success criteria assume users reach these flows through the product, not the address bar.

This phase is presentation-only — no new RPCs, no schema changes, no change to any page's existing auth/RLS behavior. It is being brainstormed and built separately from the other known gap (upload-settings enforcement), since the two share no code.

Implementation note: this repo's `AGENTS.md` requires reading `node_modules/next/dist/docs/` before writing code against a version of Next.js this far ahead of training data (currently 16.3.4 — `app/layout.tsx` already uses a typed `LayoutProps<"/">`, confirming typed routes are on). The plan step must confirm current route-group and layout conventions against those docs before implementation, not assume prior knowledge.

## 2. Out of scope (explicitly deferred)

- **Unread-message badge on the Chat tab.** Phase 9 tracks `hasUnread` per conversation, but nothing aggregates it into one nav-level count today. Brainstormed and explicitly deferred — a distinct, non-trivial piece of scope (new service function, realtime wiring into the nav) that can be its own follow-up.
- **Role-adaptive tab bar.** The bottom bar is identical for every logged-in user regardless of role; employer-only actions (Create Job, My Posted Jobs) surface inside Profile, not as swapped tabs. Chosen over a role-switching bar to avoid inventing a "current mode" concept that doesn't exist anywhere else in this app.
- **Filter-param wiring for dashboard tiles without a matching single-value filter.** `activeJobs` counts seven job statuses at once (`ACTIVE_JOB_STATUSES` in `lib/services/admin-dashboard.ts`); `/admin/jobs`'s own status filter only accepts one exact value. Rather than teach that filter a multi-status pseudo-value, tiles without a clean 1:1 filter link to the plain unfiltered list (see §6).
- **Any new auth gate.** `(main)/layout.tsx` does not add a `requireRole` check that doesn't already exist on the pages it wraps. `/jobs` currently has no page-level auth check of its own (it relies on RLS to scope what an anonymous or authenticated caller can see); this phase doesn't change that — it only decides whether the nav bar itself renders (§3.3).
- **A new shadcn primitive for the admin sidebar's mobile collapse.** Built with plain Tailwind + local component state, no `Sheet`/`Drawer` dependency added — this app currently only uses `dialog`, `select`, and similar `components/ui` primitives already in the repo.

## 3. Part A — User-facing nav (bottom tab bar)

### 3.1 Route group

Move the existing `app/jobs/`, `app/applications/`, `app/chat/`, `app/wallet/`, `app/profile/`, `app/verification/` folders under a new `app/(main)/` route group. Route groups don't affect URLs, so every existing path (`/jobs`, `/jobs/[id]`, `/wallet`, etc.) is unchanged — this is a pure file relocation, verified against current Next.js 16 route-group docs at implementation time. `/auth/*` and `/admin/*` stay outside the group and are unaffected.

### 3.2 `app/(main)/layout.tsx` (new)

```tsx
export default async function MainLayout({ children }) {
  const user = await getCurrentUser()
  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 pb-16">{children}</div>
      {user && <BottomNav />}
    </div>
  )
}
```

No `requireRole`/`requireAdminOr404` call here — each wrapped page keeps whatever auth behavior it already has (§2). The nav simply doesn't render when there's no current user.

### 3.3 `components/shared/bottom-nav.tsx` (new, client component)

Fixed-position bar (`fixed bottom-0 inset-x-0 border-t bg-background`), five tabs, identical for every logged-in user regardless of role:

| Tab | Label | Href |
| --- | --- | --- |
| Jobs | "Pekerjaan" | `/jobs` |
| Applications | "Lamaran" | `/applications/mine` |
| Chat | "Chat" | `/chat` |
| Wallet | "Wallet" | `/wallet` |
| Profile | "Profil" | `/profile` |

Uses `usePathname()` to highlight the active tab: plain `pathname.startsWith(href)` for all five (so `/jobs/123`, `/jobs/new`, `/jobs/[id]/edit` etc. all still highlight the Jobs tab). Icons from `lucide-react` (already a dependency), labels in Indonesian matching this app's existing convention (`Wallet Saya`, `Percakapan Saya`, `Lamaran Saya`, `Profil Saya`).

### 3.4 Root route (`app/page.tsx`, rewritten)

Replaces the `create-next-app` boilerplate entirely:

```tsx
export default async function Home() {
  const user = await getCurrentUser()
  redirect(user ? '/jobs' : '/auth/login')
}
```

No rendered content — this route is a pure redirect, matching the brainstormed decision to keep it minimal since the PRD names no landing-page requirement (§51: don't build outside core business flow).

### 3.5 Cross-panel link (Profile → Admin)

`app/profile/page.tsx` already computes `currentUser` for its existing `isEmployer` check. Add one more conditional link, shown only when `currentUser.roles.includes('admin')`:

```tsx
{isAdmin && <Link href="/admin">Panel Admin</Link>}
```

## 4. Part B — Admin nav (left sidebar)

### 4.1 `components/admin/admin-sidebar.tsx` (new, client component)

Rendered inside the existing `app/admin/layout.tsx` (currently only an auth guard) alongside `{children}`:

```tsx
export default async function AdminLayout({ children }) {
  await requireAdminOr404()
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <AdminSidebar />
      <div className="flex-1">{children}</div>
    </div>
  )
}
```

Links, in order, to every existing `/admin/*` section: Dashboard (`/admin`), Pengguna (`/admin/users`), Verifikasi Employer (`/admin/employer-verifications`), Pekerjaan (`/admin/jobs`), Pembayaran (`/admin/payments`), Withdrawal (`/admin/withdrawals`), Kategori (`/admin/categories`), Pengaturan (`/admin/settings`), Audit Log (`/admin/audit-logs`).

On `md:` and up: persistent left column (`md:flex md:w-56 md:flex-col md:border-r`). Below that: a top bar with a toggle button that shows/hides the link list via local `useState`, plain Tailwind (`hidden`/block toggling), no portal/overlay library.

Active section highlighted via `usePathname()`: the Dashboard link uses an *exact* match (`pathname === '/admin'`) since every other section's path also starts with `/admin`; every other link uses `startsWith` against its own path (e.g. `/admin/users`).

At the bottom of the sidebar: a "Kembali ke Aplikasi" link to `/jobs`, the admin-side half of the cross-panel link in §3.5.

## 5. Part C — Admin dashboard tile links

`app/admin/page.tsx`'s seven stat tiles currently render as static, unlinked `<div>`s. Give each an `href` where the target page already supports the exact filter that matches the stat, otherwise link to the plain unfiltered list (§2):

| Tile | Href |
| --- | --- |
| Total Pengguna | `/admin/users` |
| Total Worker | `/admin/users?role=worker` |
| Total Employer | `/admin/users?role=employer` |
| Pekerjaan Aktif | `/admin/jobs` (unfiltered — no single-status match, §2) |
| Pekerjaan Selesai | `/admin/jobs?status=completed` |
| Pembayaran Menunggu Verifikasi | `/admin/payments` (the page shows every payment, sorted with pending-verification ones first — no query-param filter exists on this page, same as the withdrawals case above) |
| Withdrawal Menunggu Proses | `/admin/withdrawals` (page has no status filter today; links to the full list) |

Each tile becomes a `<Link>` wrapping the existing tile markup, no visual change beyond becoming clickable/hoverable.

## 6. Error handling

No new failure modes: every component here reads data (`getCurrentUser`, `usePathname`) that's already fetched successfully by an existing, tested code path. `getCurrentUser()` returning `null` is an existing, handled case (used today to gate `isEmployer` on the profile page) — this phase's only new use of that `null` case is "don't render the nav," not a thrown error.

## 7. Testing

No new unit-testable logic (no new validation, no new RPC). Verified via a genuine Playwright walkthrough, matching this project's established DoD pattern:

- Logged out, visits `/` → lands on `/auth/login`. Logged in (worker), visits `/` → lands on `/jobs`.
- Worker-only account: bottom nav shows on `/jobs`, `/applications/mine`, `/chat`, `/wallet`, `/profile`; each tab navigates to its target and highlights correctly, including on a nested route (`/jobs/[id]`).
- Worker+employer account: same five tabs (no sixth tab appears); Profile still shows the pre-existing Create Job / My Posted Jobs links.
- Admin account (also a worker): Profile shows "Panel Admin" → `/admin`; admin sidebar shows all nine links, each navigating correctly, plus "Kembali ke Aplikasi" → `/jobs`; sidebar collapses to a toggle below the `md:` breakpoint.
- Admin dashboard: each of the seven tiles navigates to the href in §5's table.
- `/auth/login`, `/auth/register` still render with no bottom nav and no admin sidebar (outside both layouts).

## 8. Open assumptions

- **The nav renders only when `getCurrentUser()` resolves non-null.** If `/jobs` is ever reached anonymously (it has no page-level auth check of its own), no bottom nav appears — this is unchanged from today's behavior (there was never a nav bar before), not a new restriction.
- **`app/(main)/` is a pure relocation.** No file inside `jobs/`, `applications/`, `chat/`, `wallet/`, `profile/`, `verification/` changes its own logic, imports, or auth checks as part of this move — only its filesystem location changes.
- **Tab bar order and the five chosen items are final for this phase.** Not user-configurable, not role-adaptive (§2) — Jobs, Lamaran, Chat, Wallet, Profil, in that order, for every logged-in user.
- **Admin sidebar order matches PRD §32-40's section order** (Dashboard, User Management, Employer Verification, Job Management, Payment Management, Withdrawal Management, Category Management, Settings, Audit Log) rather than alphabetical or usage-frequency order.
