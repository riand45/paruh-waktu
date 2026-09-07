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
