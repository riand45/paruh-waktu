-- Seed the Admin's bank-transfer destination as a platform setting. No
-- settings-editor UI exists yet for this or the pre-existing fee settings
-- (platform_fee_percentage/platform_fee_payer) — an Admin must update this
-- value via direct DB access until a future phase builds that UI.
insert into public.platform_settings (key, value) values
  ('admin_bank_account', '{"bank_name": "Bank Central Asia", "account_number": "1234567890", "account_holder_name": "PARUH WAKTU ADMIN"}')
on conflict (key) do nothing;

-- Atomically create a job's payment record on the employer's first view of
-- an assigned job, and transition the job to waiting_payment. Idempotent:
-- returns the existing payment id if one already exists, regardless of the
-- job's current status, so it is always safe to call on every view.
create or replace function public.get_or_create_payment(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_job_status text;
  v_payment_amount numeric;
  v_payment_id uuid;
  v_fee_percentage numeric;
  v_fee_payer text;
  v_platform_fee numeric;
  v_total_amount numeric;
begin
  select employer_id, status, payment_amount into v_employer_id, v_job_status, v_payment_amount
  from public.jobs
  where id = p_job_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  select id into v_payment_id from public.payments where job_id = p_job_id;
  if v_payment_id is not null then
    return v_payment_id;
  end if;

  if v_job_status <> 'assigned' then
    raise exception 'CONFLICT: job not assigned';
  end if;

  select (value #>> '{}')::numeric into v_fee_percentage
  from public.platform_settings where key = 'platform_fee_percentage';
  if v_fee_percentage is null then
    v_fee_percentage := 10;
  end if;

  select value #>> '{}' into v_fee_payer
  from public.platform_settings where key = 'platform_fee_payer';
  if v_fee_payer is null then
    v_fee_payer := 'employer';
  end if;

  v_platform_fee := round(v_payment_amount * v_fee_percentage / 100, 2);
  v_total_amount := case
    when v_fee_payer = 'employer' then v_payment_amount + v_platform_fee
    else v_payment_amount
  end;

  insert into public.payments (job_id, employer_id, amount, platform_fee, total_amount, fee_payer, status)
  values (p_job_id, v_employer_id, v_payment_amount, v_platform_fee, v_total_amount, v_fee_payer, 'waiting_payment')
  returning id into v_payment_id;

  update public.jobs set status = 'waiting_payment' where id = p_job_id;

  return v_payment_id;
end;
$$;

revoke execute on function public.get_or_create_payment from public, anon, service_role;
grant execute on function public.get_or_create_payment to authenticated;

-- Atomically record a payment proof upload, set the transfer date, and
-- transition the payment/job into the admin-review state. Allows
-- resubmission after a rejection (status can be 'waiting_payment' on first
-- submission or 'rejected' on a resubmission) — no cap on retries.
create or replace function public.submit_payment_proof(
  p_payment_id uuid,
  p_file_path text,
  p_file_size_bytes bigint,
  p_transfer_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_status text;
  v_job_id uuid;
  v_proof_id uuid;
begin
  select employer_id, status, job_id into v_employer_id, v_status, v_job_id
  from public.payments
  where id = p_payment_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: payment';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status not in ('waiting_payment', 'rejected') then
    raise exception 'CONFLICT: payment not awaiting proof';
  end if;

  insert into public.payment_proofs (payment_id, uploaded_by, file_path, file_size_bytes)
  values (p_payment_id, (select auth.uid()), p_file_path, p_file_size_bytes)
  returning id into v_proof_id;

  update public.payments
  set status = 'waiting_verification',
      transfer_date = p_transfer_date,
      rejection_reason = null
  where id = p_payment_id;

  update public.jobs
  set status = 'payment_review'
  where id = v_job_id;

  return v_proof_id;
end;
$$;

revoke execute on function public.submit_payment_proof from public, anon, service_role;
grant execute on function public.submit_payment_proof to authenticated;

-- Atomically record Admin's payment-verification decision. Mirrors
-- review_employer_verification's exact shape (Phase 3).
create or replace function public.review_payment(
  p_payment_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_decision not in ('verified', 'rejected') then
    raise exception 'VALIDATION_ERROR: invalid decision %', p_decision;
  end if;

  if p_decision = 'rejected'
     and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'VALIDATION_ERROR: rejection_reason required';
  end if;

  select job_id, status into v_job_id, v_status
  from public.payments
  where id = p_payment_id
  for update;

  if v_job_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'waiting_verification' then
    raise exception 'CONFLICT: already reviewed';
  end if;

  update public.payments
  set status = p_decision,
      verified_at = now(),
      verified_by = (select auth.uid()),
      rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else null end
  where id = p_payment_id;

  update public.jobs
  set status = case when p_decision = 'verified' then 'payment_verified' else 'payment_rejected' end
  where id = v_job_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values (
    (select auth.uid()),
    case when p_decision = 'verified' then 'PAYMENT_VERIFIED' else 'PAYMENT_REJECTED' end,
    'payment',
    p_payment_id,
    case when p_decision = 'rejected' then p_rejection_reason else null end
  );
end;
$$;

revoke execute on function public.review_payment from public, anon, service_role;
grant execute on function public.review_payment to authenticated;
