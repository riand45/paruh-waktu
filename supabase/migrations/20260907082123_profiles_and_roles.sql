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
