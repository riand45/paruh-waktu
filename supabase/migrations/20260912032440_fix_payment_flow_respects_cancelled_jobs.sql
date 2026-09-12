-- Phase 11 final-review fix (1/3): cancel_job (this phase) makes
-- jobs.status = 'cancelled' reachable while a payments row still sits in
-- waiting_payment/rejected/waiting_verification -- a state that was
-- impossible before this phase, since the only prior canceller
-- (cancel_job_and_refund) required a verified payment. Neither of these
-- two pre-existing RPCs checked jobs.status at all, so an employer could
-- still submit proof, or an admin could still verify one, on an already-
-- cancelled job, silently un-cancelling it. Add the missing guard to both.
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
  v_job_status text;
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

  select status into v_job_status from public.jobs where id = v_job_id for update;
  if v_job_status = 'cancelled' then
    raise exception 'CONFLICT: job cancelled';
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
  v_job_status text;
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

  select status into v_job_status from public.jobs where id = v_job_id for update;
  if v_job_status = 'cancelled' then
    raise exception 'CONFLICT: job cancelled';
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

-- Phase 11 final-review fix (2/3): category names had only client-side
-- non-empty validation -- the RPC itself accepted a blank/whitespace-only
-- name (create) or rename, and did no trimming, so "Online" and " online "
-- could coexist as separate categories despite the unique constraint.
create or replace function public.create_job_category(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  v_name := trim(p_name);
  if length(v_name) = 0 then
    raise exception 'VALIDATION_ERROR: name required';
  end if;

  begin
    insert into public.job_categories (name) values (v_name) returning id into v_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: category name already exists';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'CATEGORY_CREATED', 'job_category', v_id, v_name);

  return v_id;
end;
$$;

create or replace function public.update_job_category(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  v_name := trim(p_name);
  if length(v_name) = 0 then
    raise exception 'VALIDATION_ERROR: name required';
  end if;

  begin
    update public.job_categories set name = v_name, updated_at = now() where id = p_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: category name already exists';
  end;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'CATEGORY_UPDATED', 'job_category', p_id, v_name);
end;
$$;

-- Phase 11 final-review fix (3/3): platform_settings.updated_by had no
-- ON DELETE behavior, discovered only now because this phase is the
-- first to ever write to it -- whichever admin most recently updated any
-- setting could never have their profile/account deleted while that
-- reference stood. Nulling it out on delete is correct: it's an audit
-- trail of who last touched a setting, not something that should block
-- account deletion.
alter table public.platform_settings
  drop constraint platform_settings_updated_by_fkey,
  add constraint platform_settings_updated_by_fkey
    foreign key (updated_by) references public.profiles (id) on delete set null;
