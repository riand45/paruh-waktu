-- Security-review fix: cancel_job (20260911100044) only blocked
-- cancellation when a payment was already 'verified', routing that case
-- to cancel_job_and_refund. It never checked for a payment sitting in
-- 'waiting_verification' (the employer has uploaded a transfer proof and
-- an admin hasn't reviewed it yet). Cancelling in that window orphans the
-- payment permanently: review_payment now refuses because jobs.status =
-- 'cancelled' (20260912032440's guard), and cancel_job_and_refund refuses
-- because the payment isn't 'verified' -- there is no remaining path to
-- ever verify, reject, or refund money the employer has already claimed
-- to have sent. Widen the guard so an admin must resolve the pending
-- review (approve then cancel_job_and_refund, or reject then cancel_job)
-- before the job can be cancelled.
create or replace function public.cancel_job(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_status text;
  v_has_verified_payment boolean;
  v_has_payment_in_review boolean;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_job_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_job_status in ('cancelled', 'completed') then
    raise exception 'CONFLICT: job already cancelled or completed';
  end if;

  select exists (
    select 1 from public.payments where job_id = p_job_id and status = 'verified'
  ) into v_has_verified_payment;

  if v_has_verified_payment then
    raise exception 'CONFLICT: use cancel_job_and_refund';
  end if;

  select exists (
    select 1 from public.payments where job_id = p_job_id and status = 'waiting_verification'
  ) into v_has_payment_in_review;

  if v_has_payment_in_review then
    raise exception 'CONFLICT: resolve pending payment review first';
  end if;

  update public.jobs
  set status = 'cancelled', cancelled_reason = p_reason
  where id = p_job_id;

  update public.job_assignments
  set status = 'cancelled'
  where job_id = p_job_id and status = 'active';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'JOB_CANCELLED', 'job', p_job_id, p_reason);
end;
$$;
