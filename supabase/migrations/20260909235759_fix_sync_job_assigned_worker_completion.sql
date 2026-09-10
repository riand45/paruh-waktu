-- Fix I4's sync_job_assigned_worker trigger (20260907120351): its null-out
-- branch was written with only the 'cancelled' case in mind (per its own
-- header comment: keep RLS in sync when an assignment is voided), but its
-- condition (new.status is distinct from 'active') also matched
-- 'completed' -- a value job_assignments.status never took until
-- confirm_job_completion (Phase 7) introduced it. That silently nulled
-- jobs.assigned_worker_id the moment a job was completed, breaking
-- start_work's idempotency guard and every RLS policy keyed off
-- assigned_worker_id (jobs/job_evidences/payments/payment_proofs/storage)
-- for the worker's own finished job. Narrow the null-out branch to the
-- 'cancelled' case it was actually meant for; everything else is
-- unchanged.
create or replace function public.sync_job_assigned_worker()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'active' then
    update public.jobs set assigned_worker_id = new.worker_id where id = new.job_id;
  elsif tg_op = 'UPDATE' then
    if new.status = 'active' and old.status is distinct from 'active' then
      update public.jobs set assigned_worker_id = new.worker_id where id = new.job_id;
    elsif old.status = 'active' and new.status = 'cancelled' then
      update public.jobs
      set assigned_worker_id = null
      where id = new.job_id and assigned_worker_id = new.worker_id;
    end if;
  end if;
  return new;
end;
$$;
