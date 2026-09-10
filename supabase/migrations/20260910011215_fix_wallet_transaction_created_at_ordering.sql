-- Fix confirm_job_completion (20260909234329): neither wallet_transactions
-- insert set created_at explicitly, so both defaulted to now(), which is
-- transaction_timestamp() -- identical for the job_income row and the
-- conditional platform_fee row since they happen inside the same
-- transaction. lib/services/wallet.ts orders the wallet page's transaction
-- list by created_at descending with no tiebreaker, so for a
-- fee_payer <> 'employer' job (which produces both rows), Postgres gave no
-- guarantee which row rendered first -- the running balance column could
-- appear to go backwards. Fix: set created_at = clock_timestamp() on both
-- inserts, which genuinely advances as statements execute within a
-- transaction, so the second insert (platform_fee, which always runs after
-- job_income in this function's control flow) gets a strictly later
-- timestamp. Everything else about the function is unchanged.
create or replace function public.confirm_job_completion(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_status text;
  v_assigned_worker_id uuid;
  v_payment_status text;
  v_amount numeric;
  v_platform_fee numeric;
  v_fee_payer text;
  v_wallet_id uuid;
  v_balance numeric;
begin
  select employer_id, status, assigned_worker_id
  into v_employer_id, v_status, v_assigned_worker_id
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'waiting_confirmation' then
    raise exception 'CONFLICT: job not waiting for confirmation';
  end if;

  select status, amount, platform_fee, fee_payer
  into v_payment_status, v_amount, v_platform_fee, v_fee_payer
  from public.payments
  where job_id = p_job_id;

  if v_payment_status is distinct from 'verified' then
    raise exception 'CONFLICT: payment not verified';
  end if;

  insert into public.wallets (user_id)
  values (v_assigned_worker_id)
  on conflict (user_id) do nothing;

  select id, balance into v_wallet_id, v_balance
  from public.wallets
  where user_id = v_assigned_worker_id
  for update;

  v_balance := v_balance + v_amount;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_after, related_job_id, idempotency_key, created_by, created_at
  )
  values (
    v_wallet_id, 'job_income', v_amount, v_balance, p_job_id,
    'job_income:' || p_job_id, (select auth.uid()), clock_timestamp()
  );

  if v_fee_payer <> 'employer' then
    v_balance := v_balance - v_platform_fee;

    insert into public.wallet_transactions (
      wallet_id, type, amount, balance_after, related_job_id, idempotency_key, created_by, created_at
    )
    values (
      v_wallet_id, 'platform_fee', -v_platform_fee, v_balance, p_job_id,
      'platform_fee:' || p_job_id, (select auth.uid()), clock_timestamp()
    );
  end if;

  update public.wallets set balance = v_balance where id = v_wallet_id;

  update public.job_assignments
  set status = 'completed'
  where job_id = p_job_id and status = 'active';

  update public.jobs set status = 'completed' where id = p_job_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'JOB_COMPLETED', 'job', p_job_id, null);
end;
$$;

revoke execute on function public.confirm_job_completion from public, anon, service_role;
grant execute on function public.confirm_job_completion to authenticated;
