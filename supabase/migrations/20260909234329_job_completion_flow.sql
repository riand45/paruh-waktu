-- Idempotent lazy transition, triggered by the assigned worker's first
-- view of the job-completion page: payment_verified -> in_progress. Safe
-- to call on every view (a no-op once already in_progress or later),
-- mirroring get_or_create_payment's precedent from Phase 6.
create or replace function public.start_work(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_worker_id uuid;
  v_status text;
begin
  select assigned_worker_id, status into v_assigned_worker_id, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_assigned_worker_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status in ('in_progress', 'waiting_confirmation', 'completed') then
    return;
  end if;

  if v_status <> 'payment_verified' then
    raise exception 'CONFLICT: job not ready to start';
  end if;

  update public.jobs set status = 'in_progress' where id = p_job_id;
end;
$$;

revoke execute on function public.start_work from public, anon, service_role;
grant execute on function public.start_work to authenticated;

-- Atomically record a work-evidence upload. No rework/reject path exists
-- once completion is submitted, so this only accepts uploads while the
-- job is in_progress.
create or replace function public.record_job_evidence(
  p_job_id uuid,
  p_file_path text,
  p_file_type text,
  p_file_size_bytes bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_worker_id uuid;
  v_status text;
  v_assignment_id uuid;
  v_evidence_id uuid;
begin
  select assigned_worker_id, status into v_assigned_worker_id, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_assigned_worker_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'in_progress' then
    raise exception 'CONFLICT: job not in progress';
  end if;

  if p_file_path not like p_job_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside job folder';
  end if;

  select id into v_assignment_id
  from public.job_assignments
  where job_id = p_job_id and status = 'active';

  if v_assignment_id is null then
    raise exception 'NOT_FOUND: active assignment';
  end if;

  insert into public.job_evidences (job_id, assignment_id, uploaded_by, file_path, file_type, file_size_bytes)
  values (p_job_id, v_assignment_id, (select auth.uid()), p_file_path, p_file_type, p_file_size_bytes)
  returning id into v_evidence_id;

  return v_evidence_id;
end;
$$;

revoke execute on function public.record_job_evidence from public, anon, service_role;
grant execute on function public.record_job_evidence to authenticated;

-- Worker submits the completion request: requires at least one evidence
-- file to already exist. No cap on evidence count, no rework path after
-- this point.
create or replace function public.submit_job_completion(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assigned_worker_id uuid;
  v_status text;
  v_evidence_count int;
begin
  select assigned_worker_id, status into v_assigned_worker_id, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_assigned_worker_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'in_progress' then
    raise exception 'CONFLICT: job not in progress';
  end if;

  select count(*) into v_evidence_count
  from public.job_evidences
  where job_id = p_job_id;

  if v_evidence_count = 0 then
    raise exception 'VALIDATION_ERROR: at least one evidence file required';
  end if;

  update public.jobs set status = 'waiting_confirmation' where id = p_job_id;
end;
$$;

revoke execute on function public.submit_job_completion from public, anon, service_role;
grant execute on function public.submit_job_completion to authenticated;

-- Employer confirms completion: one atomic transaction that reads the
-- job's already-verified payment for its locked-in amount/fee/fee_payer
-- (never live platform_settings, which could have changed since the
-- payment was verified), lazily creates the worker's wallet if needed,
-- credits it, marks the assignment and job completed, and writes an
-- audit log entry. No reject/rework path exists for this action.
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
    wallet_id, type, amount, balance_after, related_job_id, idempotency_key, created_by
  )
  values (
    v_wallet_id, 'job_income', v_amount, v_balance, p_job_id,
    'job_income:' || p_job_id, (select auth.uid())
  );

  if v_fee_payer <> 'employer' then
    v_balance := v_balance - v_platform_fee;

    insert into public.wallet_transactions (
      wallet_id, type, amount, balance_after, related_job_id, idempotency_key, created_by
    )
    values (
      v_wallet_id, 'platform_fee', -v_platform_fee, v_balance, p_job_id,
      'platform_fee:' || p_job_id, (select auth.uid())
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
