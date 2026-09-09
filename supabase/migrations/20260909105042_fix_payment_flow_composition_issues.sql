-- Consolidated fixes found during the whole-branch review of Phase 6
-- (Manual Payment Flow):
--
-- 1. submit_payment_proof was nulling out rejection_reason on every
--    submission, including a resubmission after a rejection. Since
--    waiting_verification (the status that makes the Admin's review form
--    show the "Alasan Penolakan Sebelumnya" block) is only reachable via
--    this function, the previous rejection reason was always already null
--    by the time an admin reviewed a resubmission. Fix: stop clearing it
--    here — review_payment (unchanged) already overwrites it correctly on
--    the next decision (case-based set, not append), and sets it back to
--    null when the decision is 'verified'.
--
-- 2. get_or_create_payment silently produced a wrong total_amount for any
--    fee_payer value other than the two it explicitly checks for, because
--    the case expression's `else` branch treats anything not equal to
--    'employer' as if it were 'worker'/'split'. Add an explicit guard so a
--    genuinely invalid/unrecognized platform_settings value fails loudly
--    instead of silently miscalculating. Note: this does NOT change the
--    existing 'split' behavior (it still falls through to the same branch
--    as 'worker' — a separately-tracked, deliberately-deferred minor).
--
-- 3. The seeded admin_bank_account value looked like a real, working bank
--    account (a real bank name and a plausible account number), so if it
--    were ever accidentally shipped as-is, users would have no way to tell
--    it apart from a real destination. Replace it with an obviously-a-
--    placeholder value; app/jobs/[id]/payment/page.tsx is updated
--    separately (application code, not this migration) to validate the
--    shape of this setting at render time and show an explicit error
--    instead of silently omitting the bank-details block.

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

  if p_file_path not like p_payment_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside payment folder';
  end if;

  insert into public.payment_proofs (payment_id, uploaded_by, file_path, file_size_bytes)
  values (p_payment_id, (select auth.uid()), p_file_path, p_file_size_bytes)
  returning id into v_proof_id;

  update public.payments
  set status = 'waiting_verification',
      transfer_date = p_transfer_date
  where id = p_payment_id;

  update public.jobs
  set status = 'payment_review'
  where id = v_job_id;

  return v_proof_id;
end;
$$;

revoke execute on function public.submit_payment_proof from public, anon, service_role;
grant execute on function public.submit_payment_proof to authenticated;

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

  if v_fee_payer not in ('employer', 'worker', 'split') then
    raise exception 'VALIDATION_ERROR: unsupported fee_payer %', v_fee_payer;
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

-- Replace the plausible-looking real bank account seed value with an
-- obviously-a-placeholder one, so a missed configuration step is visibly
-- broken instead of quietly pointing users at a real-looking destination.
update public.platform_settings
set value = '{"bank_name": "BELUM DIATUR", "account_number": "BELUM DIATUR", "account_holder_name": "Hubungi Admin untuk info rekening"}'
where key = 'admin_bank_account';
