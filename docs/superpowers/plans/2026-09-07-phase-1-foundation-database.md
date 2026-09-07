# Phase 1 — Foundation & Database Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the entire PARUH WAKTU database schema (20 tables, RLS, storage buckets) on the existing remote Supabase project, plus the foundational server infrastructure (service-role client, auth/role helpers, error handling, shared UI primitives) that every later feature phase builds on.

**Architecture:** Every mutation flows through a thin Server Action → a `server-only` Data Access Layer (DAL) function under `lib/services/<domain>/` that re-verifies authentication and authorization, validates input, and talks to Postgres → RLS as defense-in-depth. With one deliberate exception (`messages`, for realtime UX) and one low-risk exception (`notifications.is_read`), **every table's Row Level Security only grants `SELECT`** (scoped to the owner/participant, or an admin). All `INSERT`/`UPDATE`/`DELETE` on business tables happen exclusively through the service-role client inside the DAL, never through the browser's session-scoped (anon/authenticated) client. This phase creates the full schema up front (rather than growing it phase-by-phase) because relationships and RLS predicates between tables (jobs ↔ applications ↔ assignments ↔ payments ↔ wallet) are easier to get right when authored together, and later phases should never need a schema-shape change, only new service functions and UI.

**Tech Stack:** Next.js 16 (App Router, "proxy.ts" replaces "middleware.ts" — same semantics), TypeScript, React 19, Tailwind v4, shadcn/ui (`base-nova` style, `@base-ui/react` primitives, `cn` package), Supabase (Postgres + Auth + Storage), Supabase CLI (via `npx`, already available — v2.116.0) linked directly to the existing remote project, Vitest for unit tests.

**Spec:** `docs/PRD — PARUH WAKTU MVP.md` and `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md`

## Global Constraints

- Every Server Action/Route Handler must independently re-verify authentication and authorization inside itself — a page-level check or `proxy.ts` redirect never suffices (Next.js 16 "Data Security" guide: a proxy matcher change can silently stop covering a route, and Server Functions are POST endpoints reachable directly).
- Business logic lives in a `server-only` Data Access Layer under `lib/services/<domain>/`; Server Actions and Route Handlers stay thin and delegate to it.
- Never trust client-sent values for: `role`, `user_id`, `status`, `wallet_balance`, `fee`, `total_amount`, `net_amount`, `payment_status`, `verification_status`.
- RLS is enabled on every table in `public`. Policies always combine a `TO authenticated` (or `TO anon`) clause with an ownership/participation predicate — never `TO authenticated` alone.
- Except for `messages` (participant-scoped `INSERT`, for realtime chat) and `notifications.is_read` (owner-scoped `UPDATE`, low-risk UX), **no table grants client-side `INSERT`/`UPDATE`/`DELETE` via RLS.** All other writes go through the service-role client inside the DAL.
- `SUPABASE_SERVICE_ROLE_KEY` is read only inside modules guarded by `import 'server-only'`; it is never exposed to a client bundle.
- All status/enum-like columns are `text` + `CHECK` constraint, not native Postgres `enum` types, so adding a new value later is a simple migration rather than an `ALTER TYPE`.
- Platform fee is configurable via `platform_settings`, never hardcoded. **MVP assumption (Section 58 ambiguity handling):** default fee is `10%`, paid by `employer`. This is a seeded, admin-changeable value, not a permanent business rule.
- Every table uses a UUID primary key (`gen_random_uuid()`), explicit foreign keys, appropriate indexes/unique/check constraints, and `created_at` (+ `updated_at` where the row is ever updated).
- No `src/` directory in this project — application code stays under `app/`, `components/`, `lib/`, matching the existing scaffold.
- `profiles` is the one exception to "no client writes": its RLS still only grants `SELECT` (broad: any authenticated user, since a marketplace needs to show counterpart names). Sensitive columns (`phone`, `address`, `latitude`, `longitude`, `account_status`) must never be included in a response to anyone but the row's owner or an admin — enforce this in the DAL's DTO layer (`getPublicProfile` vs `getOwnProfile`), per the Next.js Data Access Layer / DTO pattern.

---

### Task 1: Link the Supabase CLI to the existing remote project

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `supabase/.temp/` (via CLI, git-ignored)

**Interfaces:**
- Produces: a linked local `supabase/` CLI project pointing at remote project ref `msvhvkthvwdabwlgmwyi`, used by every later task's `supabase migration new` / `supabase db push`.

- [ ] **Step 1: Get a Supabase personal access token**

This requires a one-time manual action: open https://supabase.com/dashboard/account/tokens, create a token, and export it in your shell:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- [ ] **Step 2: Initialize the CLI project**

```bash
npx supabase init
```

Expected: creates `supabase/config.toml` and `supabase/migrations/` (empty). When prompted to generate VS Code settings, either answer is fine.

- [ ] **Step 3: Link to the remote project**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

You'll be prompted for the database password (Dashboard → Project Settings → Database → Connection string, or reset it there if unknown). Expected output ends with `Finished supabase link`.

- [ ] **Step 4: Verify the link**

```bash
npx supabase migration list
```

Expected: an empty local/remote migration table (no rows yet) with no error — confirms the CLI can reach the project.

- [ ] **Step 5: Commit**

```bash
git add supabase/config.toml .gitignore
git commit -m "chore: link Supabase CLI to remote project"
```

(Add `supabase/.temp` to `.gitignore` first if the CLI didn't already.)

---

### Task 2: Migration — profiles, roles, and shared helper functions

**Files:**
- Create: `supabase/migrations/<timestamp>_profiles_and_roles.sql`

**Interfaces:**
- Produces: `public.profiles(id, full_name, phone, avatar_url, address, latitude, longitude, account_status, created_at, updated_at)`, `public.user_roles(id, user_id, role, granted_at, granted_by)`, `public.is_admin()`, `public.set_updated_at()`, trigger `on_auth_user_created` (auto-provisions profile + `worker` role on signup).
- Consumes: nothing (first schema migration).

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new profiles_and_roles
```

Note the generated filename (e.g. `supabase/migrations/20260907120000_profiles_and_roles.sql`) — you'll edit that exact file in the next step.

- [ ] **Step 2: Write the migration**

Replace the file's contents with:

```sql
-- Shared helper: bump updated_at on any row update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles: one row per auth.users row, created by the trigger below.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  address text,
  latitude double precision,
  longitude double precision,
  account_status text not null default 'active'
    check (account_status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- user_roles: a user may hold multiple roles (worker + employer + admin).
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('worker', 'employer', 'admin')),
  granted_at timestamptz not null default now(),
  granted_by uuid references public.profiles (id),
  unique (user_id, role)
);

create index user_roles_user_id_idx on public.user_roles (user_id);

-- Self-check helper used by RLS policies across the whole schema.
-- SECURITY INVOKER is sufficient: it only ever reads the caller's own
-- user_roles row, which the "own row" SELECT policy below already permits.
create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

-- Auto-provision a profile + default "worker" role on signup.
-- SECURITY DEFINER is required here (and only here): this trigger fires
-- during signup before any authenticated session exists, and profiles/
-- user_roles intentionally have no client-facing INSERT policy. The
-- function cannot be invoked outside a trigger context (it relies on the
-- implicit `new` row), so it is not an exploitable public RPC endpoint.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  );

  insert into public.user_roles (user_id, role)
  values (new.id, 'worker');

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;

-- Any authenticated user may read any profile row at the DB layer (needed
-- so employers/workers can see each other's name+avatar in a marketplace).
-- Sensitive columns (phone/address/lat/lng/account_status) must be
-- stripped by the DAL's DTO functions before reaching anyone but the
-- owner or an admin — see lib/services/profiles.
create policy "profiles_select_all_authenticated"
on public.profiles for select
to authenticated
using (true);

create policy "user_roles_select_own_or_admin"
on public.user_roles for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());
```

- [ ] **Step 3: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`.

- [ ] **Step 4: Verify**

```bash
npx supabase migration list
```

Expected: the `profiles_and_roles` migration now shows as applied on both `Local` and `Remote` columns.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add profiles, user_roles, and shared RLS helpers"
```

---

### Task 3: Migration — employer verification, platform settings, job categories

**Files:**
- Create: `supabase/migrations/<timestamp>_employer_verification_and_settings.sql`

**Interfaces:**
- Produces: `public.employer_verifications`, `public.platform_settings`, `public.job_categories`, seeded rows in the latter two.
- Consumes: `public.profiles`, `public.is_admin()`, `public.set_updated_at()` (Task 2).

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new employer_verification_and_settings
```

- [ ] **Step 2: Write the migration**

```sql
create table public.employer_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  full_name_on_ktp text not null,
  ktp_number text not null,
  ktp_document_path text not null,
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A user cannot have two verification requests pending at once, but may
-- resubmit after a rejection (Section 7.3/58: safest MVP assumption).
create unique index employer_verifications_one_pending_per_user
  on public.employer_verifications (user_id)
  where (status = 'pending');

create index employer_verifications_user_id_idx
  on public.employer_verifications (user_id);

create trigger set_employer_verifications_updated_at
  before update on public.employer_verifications
  for each row execute function public.set_updated_at();

create table public.job_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_job_categories_updated_at
  before update on public.job_categories
  for each row execute function public.set_updated_at();

insert into public.job_categories (name) values
  ('Bantuan Sekitar'),
  ('Pekerjaan Fisik Ringan'),
  ('Bantuan Digital'),
  ('Kreatif'),
  ('Online');

-- Key/value configuration table (Section 30/58): every business-tunable
-- value the Admin can change without a code deploy.
create table public.platform_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id)
);

create trigger set_platform_settings_updated_at
  before update on public.platform_settings
  for each row execute function public.set_updated_at();

insert into public.platform_settings (key, value) values
  ('platform_fee_percentage', '10'),
  ('platform_fee_payer', '"employer"'),
  ('default_job_radius_km', '10'),
  ('max_upload_size_mb', '5'),
  ('allowed_file_types',
    '["image/jpeg", "image/png", "image/webp", "video/mp4"]');

-- RLS
alter table public.employer_verifications enable row level security;
alter table public.job_categories enable row level security;
alter table public.platform_settings enable row level security;

create policy "employer_verifications_select_own_or_admin"
on public.employer_verifications for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy "job_categories_select_active_or_admin"
on public.job_categories for select
to authenticated
using (is_active = true or public.is_admin());

create policy "platform_settings_select_authenticated"
on public.platform_settings for select
to authenticated
using (true);
```

- [ ] **Step 3: Push and verify**

```bash
npx supabase db push
npx supabase migration list
```

Expected: both migrations now listed as applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add employer verification, job categories, platform settings"
```

---

### Task 4: Migration — jobs, applications, assignments, attachments, evidences

**Files:**
- Create: `supabase/migrations/<timestamp>_jobs_and_applications.sql`

**Interfaces:**
- Produces: `public.jobs`, `public.job_applications`, `public.job_assignments`, `public.job_attachments`, `public.job_evidences`.
- Consumes: `public.profiles`, `public.job_categories`, `public.is_admin()`, `public.set_updated_at()`.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new jobs_and_applications
```

- [ ] **Step 2: Write the migration**

```sql
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  employer_id uuid not null references public.profiles (id),
  category_id uuid not null references public.job_categories (id),
  title text not null,
  description text not null,
  address text not null,
  latitude double precision not null,
  longitude double precision not null,
  payment_amount numeric(12, 2) not null check (payment_amount > 0),
  duration_minutes integer not null check (duration_minutes > 0),
  deadline timestamptz not null,
  status text not null default 'draft' check (
    status in (
      'draft', 'open', 'assigned', 'waiting_payment', 'payment_review',
      'payment_verified', 'in_progress', 'waiting_confirmation',
      'completed', 'cancelled', 'payment_rejected'
    )
  ),
  assigned_worker_id uuid references public.profiles (id),
  cancelled_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index jobs_employer_id_idx on public.jobs (employer_id);
create index jobs_status_idx on public.jobs (status);
create index jobs_category_id_idx on public.jobs (category_id);
create index jobs_assigned_worker_id_idx on public.jobs (assigned_worker_id);

create trigger set_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  worker_id uuid not null references public.profiles (id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  message text,
  applied_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A worker may only have one *active* application per job at a time, but
-- may re-apply after a rejection/cancellation (Section 12/58 assumption).
create unique index job_applications_one_active_per_worker_job
  on public.job_applications (job_id, worker_id)
  where (status in ('pending', 'accepted'));

create index job_applications_job_id_idx on public.job_applications (job_id);
create index job_applications_worker_id_idx on public.job_applications (worker_id);

create trigger set_job_applications_updated_at
  before update on public.job_applications
  for each row execute function public.set_updated_at();

create table public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  worker_id uuid not null references public.profiles (id),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  assigned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Defense-in-depth against the race described in Section 13: the DAL's
-- assignment transaction is the primary guard, this partial unique index
-- makes a second *active* assignment on the same job impossible at the DB
-- level even under concurrent writers.
create unique index job_assignments_one_active_per_job
  on public.job_assignments (job_id)
  where (status = 'active');

create index job_assignments_worker_id_idx on public.job_assignments (worker_id);

create trigger set_job_assignments_updated_at
  before update on public.job_assignments
  for each row execute function public.set_updated_at();

create table public.job_attachments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  file_path text not null,
  file_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create index job_attachments_job_id_idx on public.job_attachments (job_id);

create table public.job_evidences (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  assignment_id uuid not null references public.job_assignments (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  file_path text not null,
  file_type text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create index job_evidences_job_id_idx on public.job_evidences (job_id);
create index job_evidences_assignment_id_idx on public.job_evidences (assignment_id);

-- RLS
alter table public.jobs enable row level security;
alter table public.job_applications enable row level security;
alter table public.job_assignments enable row level security;
alter table public.job_attachments enable row level security;
alter table public.job_evidences enable row level security;

create policy "jobs_select_open_or_involved_or_admin"
on public.jobs for select
to authenticated
using (
  status = 'open'
  or employer_id = (select auth.uid())
  or assigned_worker_id = (select auth.uid())
  or public.is_admin()
);

create policy "job_applications_select_involved_or_admin"
on public.job_applications for select
to authenticated
using (
  worker_id = (select auth.uid())
  or exists (
    select 1 from public.jobs j
    where j.id = job_applications.job_id
    and j.employer_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "job_assignments_select_involved_or_admin"
on public.job_assignments for select
to authenticated
using (
  worker_id = (select auth.uid())
  or exists (
    select 1 from public.jobs j
    where j.id = job_assignments.job_id
    and j.employer_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "job_attachments_select_visible_job_or_admin"
on public.job_attachments for select
to authenticated
using (
  exists (
    select 1 from public.jobs j
    where j.id = job_attachments.job_id
    and (
      j.status = 'open'
      or j.employer_id = (select auth.uid())
      or j.assigned_worker_id = (select auth.uid())
    )
  )
  or public.is_admin()
);

create policy "job_evidences_select_involved_or_admin"
on public.job_evidences for select
to authenticated
using (
  exists (
    select 1 from public.jobs j
    where j.id = job_evidences.job_id
    and (
      j.employer_id = (select auth.uid())
      or j.assigned_worker_id = (select auth.uid())
    )
  )
  or public.is_admin()
);
```

- [ ] **Step 3: Push and verify**

```bash
npx supabase db push
npx supabase migration list
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add jobs, applications, assignments, attachments, evidences"
```

---

### Task 5: Migration — payments, wallet, withdrawals

**Files:**
- Create: `supabase/migrations/<timestamp>_payments_and_wallet.sql`

**Interfaces:**
- Produces: `public.payments`, `public.payment_proofs`, `public.wallets`, `public.withdrawals`, `public.wallet_transactions`.
- Consumes: `public.profiles`, `public.jobs`, `public.is_admin()`, `public.set_updated_at()`.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new payments_and_wallet
```

- [ ] **Step 2: Write the migration**

```sql
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs (id),
  employer_id uuid not null references public.profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  platform_fee numeric(12, 2) not null check (platform_fee >= 0),
  total_amount numeric(12, 2) not null check (total_amount > 0),
  fee_payer text not null check (fee_payer in ('employer', 'worker', 'split')),
  status text not null default 'waiting_payment'
    check (status in (
      'waiting_payment', 'waiting_verification', 'verified', 'rejected'
    )),
  transfer_date date,
  rejection_reason text,
  verified_at timestamptz,
  verified_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_employer_id_idx on public.payments (employer_id);
create index payments_status_idx on public.payments (status);

create trigger set_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

create table public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  file_path text not null,
  file_size_bytes bigint not null check (file_size_bytes > 0),
  created_at timestamptz not null default now()
);

create index payment_proofs_payment_id_idx on public.payment_proofs (payment_id);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id),
  balance numeric(12, 2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_wallets_updated_at
  before update on public.wallets
  for each row execute function public.set_updated_at();

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  bank_name text not null,
  account_number text not null,
  account_holder_name text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'paid', 'rejected')),
  transfer_proof_path text,
  rejection_reason text,
  processed_by uuid references public.profiles (id),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index withdrawals_user_id_idx on public.withdrawals (user_id);
create index withdrawals_status_idx on public.withdrawals (status);

create trigger set_withdrawals_updated_at
  before update on public.withdrawals
  for each row execute function public.set_updated_at();

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.wallets (id),
  type text not null check (
    type in ('job_income', 'platform_fee', 'withdrawal', 'refund', 'adjustment')
  ),
  amount numeric(12, 2) not null,
  balance_after numeric(12, 2) not null check (balance_after >= 0),
  related_job_id uuid references public.jobs (id),
  related_withdrawal_id uuid references public.withdrawals (id),
  description text,
  idempotency_key text unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index wallet_transactions_wallet_id_idx on public.wallet_transactions (wallet_id);

-- RLS
alter table public.payments enable row level security;
alter table public.payment_proofs enable row level security;
alter table public.wallets enable row level security;
alter table public.withdrawals enable row level security;
alter table public.wallet_transactions enable row level security;

create policy "payments_select_involved_or_admin"
on public.payments for select
to authenticated
using (
  employer_id = (select auth.uid())
  or exists (
    select 1 from public.jobs j
    where j.id = payments.job_id
    and j.assigned_worker_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "payment_proofs_select_involved_or_admin"
on public.payment_proofs for select
to authenticated
using (
  exists (
    select 1 from public.payments p
    where p.id = payment_proofs.payment_id
    and (
      p.employer_id = (select auth.uid())
      or exists (
        select 1 from public.jobs j
        where j.id = p.job_id
        and j.assigned_worker_id = (select auth.uid())
      )
    )
  )
  or public.is_admin()
);

create policy "wallets_select_own_or_admin"
on public.wallets for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy "withdrawals_select_own_or_admin"
on public.withdrawals for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

create policy "wallet_transactions_select_own_or_admin"
on public.wallet_transactions for select
to authenticated
using (
  exists (
    select 1 from public.wallets w
    where w.id = wallet_transactions.wallet_id
    and w.user_id = (select auth.uid())
  )
  or public.is_admin()
);
```

- [ ] **Step 3: Push and verify**

```bash
npx supabase db push
npx supabase migration list
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add payments, wallet ledger, and withdrawals"
```

---

### Task 6: Migration — chat, notifications, audit log

**Files:**
- Create: `supabase/migrations/<timestamp>_chat_notifications_audit.sql`

**Interfaces:**
- Produces: `public.conversations`, `public.conversation_participants`, `public.messages`, `public.notifications`, `public.audit_logs`.
- Consumes: `public.profiles`, `public.jobs`, `public.is_admin()`.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new chat_notifications_audit
```

- [ ] **Step 2: Write the migration**

```sql
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs (id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create index conversation_participants_user_id_idx
  on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages (conversation_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  type text not null,
  title text not null,
  body text,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id);

-- RLS
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "conversations_select_participant_or_admin"
on public.conversations for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id
    and cp.user_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "conversation_participants_select_involved_or_admin"
on public.conversation_participants for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.conversation_participants cp2
    where cp2.conversation_id = conversation_participants.conversation_id
    and cp2.user_id = (select auth.uid())
  )
  or public.is_admin()
);

-- Deliberate exception (see plan header): messages support direct client
-- writes so Supabase Realtime can broadcast sends without a server round
-- trip. Authorization is still fully enforced by the participant check.
create policy "messages_select_participant_or_admin"
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
    and cp.user_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "messages_insert_participant"
on public.messages for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
    and cp.user_id = (select auth.uid())
  )
);

create policy "notifications_select_own_or_admin"
on public.notifications for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

-- Deliberate low-risk exception: a user may mark their own notification
-- read directly, avoiding a server round trip for a purely cosmetic flag.
create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "audit_logs_select_admin_only"
on public.audit_logs for select
to authenticated
using (public.is_admin());
```

- [ ] **Step 3: Push and verify**

```bash
npx supabase db push
npx supabase migration list
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add chat, notifications, and audit log tables"
```

---

### Task 7: Migration — storage buckets and object policies

**Files:**
- Create: `supabase/migrations/<timestamp>_storage_buckets.sql`

**Interfaces:**
- Produces: 6 storage buckets (`avatars`, `job-attachments` public; `kyc-documents`, `job-evidences`, `payment-proofs`, `withdrawal-proofs` private) with object-level RLS policies.
- Consumes: `public.jobs`, `public.payments`, `public.withdrawals`, `public.is_admin()`.

**Path conventions** (the DAL must follow these when uploading, later phases): `avatars/{user_id}/{filename}`, `kyc-documents/{user_id}/{filename}`, `job-attachments/{job_id}/{filename}`, `job-evidences/{job_id}/{filename}`, `payment-proofs/{payment_id}/{filename}`, `withdrawal-proofs/{withdrawal_id}/{filename}`.

- [ ] **Step 1: Create the migration file**

```bash
npx supabase migration new storage_buckets
```

- [ ] **Step 2: Write the migration**

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('job-attachments', 'job-attachments', true, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('kyc-documents', 'kyc-documents', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('job-evidences', 'job-evidences', false, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('payment-proofs', 'payment-proofs', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('withdrawal-proofs', 'withdrawal-proofs', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- avatars: public read (bucket flag handles this), owner-folder write.
create policy "avatars_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "avatars_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- job-attachments: public read, only the job's employer may upload while
-- the DAL still governs *when* (draft/open) — this policy only enforces
-- ownership, not job status, matching "defense in depth, not duplicated
-- business logic" from the plan header.
create policy "job_attachments_insert_own_job"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'job-attachments'
  and exists (
    select 1 from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
    and j.employer_id = (select auth.uid())
  )
);

-- kyc-documents: private, owner + admin only.
create policy "kyc_documents_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'kyc-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_admin()
  )
);

create policy "kyc_documents_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- job-evidences: private, employer + assigned worker + admin of that job.
create policy "job_evidences_select_involved_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'job-evidences'
  and (
    exists (
      select 1 from public.jobs j
      where j.id::text = (storage.foldername(name))[1]
      and (
        j.employer_id = (select auth.uid())
        or j.assigned_worker_id = (select auth.uid())
      )
    )
    or public.is_admin()
  )
);

create policy "job_evidences_insert_assigned_worker"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'job-evidences'
  and exists (
    select 1 from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
    and j.assigned_worker_id = (select auth.uid())
  )
);

-- payment-proofs: private, employer of that payment + assigned worker + admin.
create policy "payment_proofs_select_involved_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'payment-proofs'
  and (
    exists (
      select 1 from public.payments p
      where p.id::text = (storage.foldername(name))[1]
      and (
        p.employer_id = (select auth.uid())
        or exists (
          select 1 from public.jobs j
          where j.id = p.job_id
          and j.assigned_worker_id = (select auth.uid())
        )
      )
    )
    or public.is_admin()
  )
);

create policy "payment_proofs_insert_employer"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and exists (
    select 1 from public.payments p
    where p.id::text = (storage.foldername(name))[1]
    and p.employer_id = (select auth.uid())
  )
);

-- withdrawal-proofs: private. Only the withdrawal's owner may read it;
-- only Admin uploads it (Section 21/29: Admin performs the manual
-- transfer and attaches proof, the worker never uploads this one).
create policy "withdrawal_proofs_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'withdrawal-proofs'
  and (
    exists (
      select 1 from public.withdrawals w
      where w.id::text = (storage.foldername(name))[1]
      and w.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

create policy "withdrawal_proofs_insert_admin_only"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'withdrawal-proofs'
  and public.is_admin()
);
```

- [ ] **Step 3: Push and verify**

```bash
npx supabase db push
npx supabase migration list
```

Expected: all 6 migrations now show applied.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "feat(db): add storage buckets and object-level RLS policies"
```

---

### Task 8: Run advisors, generate TypeScript types

**Files:**
- Create: `lib/supabase/database.types.ts`

**Interfaces:**
- Produces: `Database` type used by every Supabase client in later tasks/phases.
- Consumes: the full remote schema from Tasks 2–7.

- [ ] **Step 1: Run the Supabase security/performance advisors**

```bash
npx supabase --help | grep -A2 "^  db"
```

If your CLI version supports it (v2.81.3+, confirmed available):

```bash
npx supabase db advisors
```

Expected: no `ERROR`-level findings. If it flags something (e.g. a missing index it recommends), read the specific finding before deciding whether it applies — do not blanket-suppress. `INFO`-level suggestions (e.g. "add an index for this foreign key" beyond what we already added) may be deferred to a later phase if they don't affect Phase 1 tables' query patterns yet.

- [ ] **Step 2: Generate TypeScript types from the linked project**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

- [ ] **Step 3: Verify the file was generated correctly**

```bash
grep -c "public:" lib/supabase/database.types.ts
```

Expected: `1` (one `public: {` schema block), and the file should contain `profiles:`, `jobs:`, `wallet_transactions:`, etc. — spot check with:

```bash
grep -o '^\s*[a-z_]*: {$' lib/supabase/database.types.ts | head -25
```

- [ ] **Step 4: Wire the type into the existing browser/server clients**

Edit `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from './database.types'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}
```

Replace `lib/supabase/server.ts` with (only the import and the generic parameter change from the original):

```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

/**
 * If using Fluid compute: Don't put this client in a global variable. Always create a new client within each
 * function when using it.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing
            // user sessions.
          }
        },
      },
    }
  )
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/database.types.ts lib/supabase/client.ts lib/supabase/server.ts
git commit -m "feat(db): generate Supabase TypeScript types and wire into clients"
```

---

### Task 9: Service-role client, auth/role helpers, Vitest setup

**Files:**
- Create: `lib/supabase/service.ts`
- Create: `lib/auth/has-role.ts`
- Create: `lib/auth/has-role.test.ts`
- Create: `lib/auth/get-current-user.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add `test`/`typecheck` scripts and devDependencies)

**Interfaces:**
- Produces: `createServiceClient()`, `hasRole(roles, role)`, `getCurrentUser()`, `requireRole(role)` — consumed by every Server Action in later phases.
- Consumes: `lib/supabase/database.types.ts` (Task 8), `lib/supabase/server.ts`.

- [ ] **Step 1: Install dependencies**

```bash
npm install server-only
npm install -D vitest vite-tsconfig-paths
```

- [ ] **Step 2: Add the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Add `test` and `typecheck` scripts**

Edit `package.json`'s `scripts` block to add:

```json
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
```

- [ ] **Step 4: Write the failing test for `hasRole`**

Create `lib/auth/has-role.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { hasRole } from './has-role'

describe('hasRole', () => {
  it('returns true when the role is present', () => {
    expect(hasRole([{ role: 'worker' }, { role: 'employer' }], 'employer')).toBe(true)
  })

  it('returns false when the role is absent', () => {
    expect(hasRole([{ role: 'worker' }], 'admin')).toBe(false)
  })

  it('returns false for an empty role list', () => {
    expect(hasRole([], 'worker')).toBe(false)
  })
})
```

- [ ] **Step 5: Run it and confirm it fails**

```bash
npx vitest run lib/auth/has-role.test.ts
```

Expected: FAIL — `Cannot find module './has-role'` (the file doesn't exist yet).

- [ ] **Step 6: Implement `hasRole`**

Create `lib/auth/has-role.ts`:

```ts
export type AppRole = 'worker' | 'employer' | 'admin'

export function hasRole(
  roles: { role: AppRole }[],
  role: AppRole
): boolean {
  return roles.some((r) => r.role === role)
}
```

- [ ] **Step 7: Run the test again and confirm it passes**

```bash
npx vitest run lib/auth/has-role.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Create the service-role client**

Create `lib/supabase/service.ts`:

```ts
import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Bypasses RLS entirely. Only ever call this from inside a server-only
 * DAL function (lib/services/**) that has already verified authentication
 * and authorization itself — see plan header "Global Constraints".
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.'
    )
  }

  return createSupabaseClient<Database>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
```

- [ ] **Step 9: Create the current-user helper**

Create `lib/auth/get-current-user.ts`:

```ts
import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { hasRole, type AppRole } from './has-role'

export interface CurrentUser {
  id: string
  email: string | null
  roles: AppRole[]
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) return null

  const { data: roleRows, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', claims.sub)

  if (error) {
    throw new Error('Failed to load roles for the current user.')
  }

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    roles: (roleRows ?? []).map((r) => r.role as AppRole),
  }
})

export async function requireRole(role: AppRole): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('UNAUTHENTICATED')
  }
  if (!hasRole(user.roles.map((r) => ({ role: r })), role)) {
    throw new Error('FORBIDDEN')
  }
  return user
}
```

Note: `getCurrentUser`/`requireRole` are exercised end-to-end (against a real session) starting in the Phase 2 (Auth) plan, once a login flow exists to produce one — that is an integration concern, not a unit-testable one, so no fake/mocked test is added here.

- [ ] **Step 10: Typecheck and run the full test suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: no type errors; all tests pass.

- [ ] **Step 11: Commit**

```bash
git add lib/supabase/service.ts lib/auth vitest.config.ts package.json package-lock.json
git commit -m "feat: add service-role client, role/auth helpers, and Vitest setup"
```

---

### Task 10: Shared UI primitives (EmptyState, LoadingState, ErrorState + shadcn additions)

**Files:**
- Create: `components/ui/input.tsx`, `components/ui/label.tsx`, `components/ui/textarea.tsx`, `components/ui/select.tsx`, `components/ui/card.tsx`, `components/ui/badge.tsx`, `components/ui/dialog.tsx`, `components/ui/skeleton.tsx`, `components/ui/table.tsx`, `components/ui/avatar.tsx`, `components/ui/separator.tsx` (via shadcn CLI)
- Create: `components/shared/empty-state.tsx`
- Create: `components/shared/loading-state.tsx`
- Create: `components/shared/error-state.tsx`

**Interfaces:**
- Produces: `<EmptyState title description? action? />`, `<LoadingState rows? />`, `<ErrorState title? message onRetry? />` — used by every list/detail page in later phases.
- Consumes: nothing new (uses the existing `components.json` shadcn config, `base-nova` style).

- [ ] **Step 1: Add the shadcn primitives**

```bash
npx shadcn@latest add input label textarea select card badge dialog skeleton table avatar separator
```

Expected: new files appear under `components/ui/`. If the CLI prompts about overwriting anything, decline (nothing existing should collide).

- [ ] **Step 2: Create `EmptyState`**

Create `components/shared/empty-state.tsx`:

```tsx
import type { ReactNode } from "react"

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
```

- [ ] **Step 3: Create `LoadingState`**

Create `components/shared/loading-state.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton"

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 py-6" role="status" aria-label="Memuat">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Create `ErrorState`**

Create `components/shared/error-state.tsx`:

```tsx
"use client"

interface ErrorStateProps {
  title?: string
  message: string
  onRetry?: () => void
}

export function ErrorState({
  title = "Terjadi kesalahan",
  message,
  onRetry,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-12 text-center">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Coba lagi
        </button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed. (Nothing renders these yet — that's expected; later phases import them.)

- [ ] **Step 6: Commit**

```bash
git add components
git commit -m "feat(ui): add shared UI primitives and empty/loading/error states"
```

---

### Task 11: Central error-handling utility + final Phase 1 verification

**Files:**
- Create: `lib/errors.ts`
- Create: `lib/errors.test.ts`

**Interfaces:**
- Produces: `AppError`, `appError(code, message?)`, `toSafeErrorMessage(error)` — used by every Server Action from Phase 2 onward to map internal errors to safe, user-facing messages without leaking database details.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

Create `lib/errors.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { AppError, appError, toSafeErrorMessage } from './errors'

describe('toSafeErrorMessage', () => {
  it('returns the public message for an AppError', () => {
    const error = appError('NOT_FOUND', 'Pekerjaan tidak ditemukan.')
    expect(toSafeErrorMessage(error)).toBe('Pekerjaan tidak ditemukan.')
  })

  it('returns a friendly message for a bare UNAUTHENTICATED error', () => {
    expect(toSafeErrorMessage(new Error('UNAUTHENTICATED'))).toMatch(/masuk/)
  })

  it('never leaks a raw unknown error message and logs it instead', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const message = toSafeErrorMessage(new Error('relation "foo" does not exist'))
    expect(message).not.toMatch(/relation/)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('constructs AppError with the default message for its code', () => {
    const error = new AppError('FORBIDDEN', 'custom')
    expect(error.code).toBe('FORBIDDEN')
    expect(error.publicMessage).toBe('custom')
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/errors.test.ts
```

Expected: FAIL — `Cannot find module './errors'`.

- [ ] **Step 3: Implement the error utility**

Create `lib/errors.ts`:

```ts
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'

export class AppError extends Error {
  readonly code: ErrorCode
  readonly publicMessage: string

  constructor(code: ErrorCode, publicMessage: string, options?: { cause?: unknown }) {
    super(publicMessage, options)
    this.code = code
    this.publicMessage = publicMessage
    this.name = 'AppError'
  }
}

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'Anda harus masuk untuk melakukan tindakan ini.',
  FORBIDDEN: 'Anda tidak memiliki akses untuk melakukan tindakan ini.',
  NOT_FOUND: 'Data yang Anda cari tidak ditemukan.',
  VALIDATION_ERROR: 'Data yang Anda masukkan tidak valid.',
  CONFLICT: 'Tindakan ini tidak dapat dilakukan karena ada perubahan data terkait.',
  INTERNAL_ERROR: 'Terjadi kesalahan pada sistem. Silakan coba lagi.',
}

export function appError(code: ErrorCode, message?: string): AppError {
  return new AppError(code, message ?? DEFAULT_MESSAGES[code])
}

export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof AppError) {
    return error.publicMessage
  }

  if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
    return DEFAULT_MESSAGES.UNAUTHENTICATED
  }

  if (error instanceof Error && error.message === 'FORBIDDEN') {
    return DEFAULT_MESSAGES.FORBIDDEN
  }

  console.error('[unhandled-error]', error)
  return DEFAULT_MESSAGES.INTERNAL_ERROR
}
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/errors.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full Phase 1 verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed with no errors. This is the Definition of Done gate for Phase 1 (Section 59): schema exists, RLS is correct, server-side helpers exist, no client-facing writes on business tables, tests pass, production build passes.

- [ ] **Step 6: Commit**

```bash
git add lib/errors.ts lib/errors.test.ts
git commit -m "feat: add central error-handling utility"
```

---

## Phase 1 Definition of Done

- [ ] All 20 tables exist on the remote project with RLS enabled and the policies above (verified via `supabase migration list` showing 6/6 applied).
- [ ] `supabase db advisors` shows no unaddressed `ERROR`-level findings.
- [ ] 6 storage buckets exist with correct public/private flags and object policies.
- [ ] `lib/supabase/database.types.ts` reflects the full schema; both Supabase clients are typed with it.
- [ ] `createServiceClient()`, `getCurrentUser()`, `requireRole()`, `hasRole()`, `AppError`/`toSafeErrorMessage()` exist and are unit-tested where testable.
- [ ] Shared `EmptyState`/`LoadingState`/`ErrorState` components exist alongside the new shadcn primitives.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] No feature UI has been built yet — that's intentional; Phase 2 (Auth & Profile) is next.
