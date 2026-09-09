-- Fix select_job_worker's employer-ownership check: `v_employer_id <>
-- (select auth.uid())` evaluates to NULL (not TRUE) whenever auth.uid() is
-- NULL, and `if NULL then` in plpgsql is treated as false — so the
-- FORBIDDEN check silently no-oped for any NULL-auth.uid() caller (e.g. a
-- service-role client with no JWT `sub` claim), letting the function
-- proceed to assign an arbitrary job. This is the sole write path for
-- jobs/job_applications/job_assignments (no RLS write policy exists on any
-- of them), so this check is the only authorization gate and must fail
-- closed unconditionally. `is distinct from` treats NULL as a genuine,
-- unequal value (matching the existing precedent in
-- 20260907120351_sync_job_assigned_worker.sql), so the check now raises
-- FORBIDDEN whenever the caller's auth.uid() isn't exactly the job's
-- employer_id, NULL included. As defense-in-depth, execute is additionally
-- revoked from service_role, since this function has no RLS backup at all.
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

  if v_employer_id is distinct from (select auth.uid()) then
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
revoke execute on function public.select_job_worker from service_role;
grant execute on function public.select_job_worker to authenticated;
