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
