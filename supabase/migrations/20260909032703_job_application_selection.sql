-- Atomically select a worker for an open job: creates the active
-- assignment, accepts the chosen application, rejects every other
-- pending application on the same job, and transitions the job to
-- 'assigned' — all in one transaction, so no concurrent caller can
-- observe (or create) a job with two active workers or two accepted
-- applications. SECURITY DEFINER so it can write job_assignments/
-- job_applications despite neither having a write RLS policy; it must
-- therefore re-derive every authorization check itself rather than
-- trust RLS.
create or replace function public.select_job_worker(
  p_job_id uuid,
  p_application_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_job_status text;
  v_worker_id uuid;
  v_application_status text;
  v_application_job_id uuid;
begin
  select employer_id, status into v_employer_id, v_job_status
  from public.jobs
  where id = p_job_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: job';
  end if;

  if v_employer_id <> (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_job_status <> 'open' then
    raise exception 'CONFLICT: job not open';
  end if;

  select job_id, worker_id, status into v_application_job_id, v_worker_id, v_application_status
  from public.job_applications
  where id = p_application_id
  for update;

  if v_worker_id is null then
    raise exception 'NOT_FOUND: application';
  end if;

  if v_application_job_id <> p_job_id then
    raise exception 'VALIDATION_ERROR: application does not belong to job';
  end if;

  if v_application_status <> 'pending' then
    raise exception 'CONFLICT: application not pending';
  end if;

  insert into public.job_assignments (job_id, worker_id, status)
  values (p_job_id, v_worker_id, 'active');

  update public.job_applications
  set status = 'accepted',
      reviewed_at = now()
  where id = p_application_id;

  update public.job_applications
  set status = 'rejected',
      reviewed_at = now()
  where job_id = p_job_id
    and id <> p_application_id
    and status = 'pending';

  update public.jobs
  set status = 'assigned'
  where id = p_job_id;
end;
$$;

revoke execute on function public.select_job_worker from public, anon;
grant execute on function public.select_job_worker to authenticated;
