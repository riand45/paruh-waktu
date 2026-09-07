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
