-- I4: jobs.assigned_worker_id is used as the authorization predicate in 6+
-- RLS policies (jobs, job_attachments, job_evidences, payments,
-- payment_proofs, and 2 storage policies), while job_assignments is the
-- actual record of truth for who is assigned (guarded by the partial
-- unique index preventing 2 simultaneous active assignments). Nothing
-- keeps them in sync; this trigger does, so a future write to
-- job_assignments can never silently desync the RLS predicate from the
-- assignment record.
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
    elsif old.status = 'active' and new.status is distinct from 'active' then
      update public.jobs
      set assigned_worker_id = null
      where id = new.job_id and assigned_worker_id = new.worker_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger sync_job_assigned_worker
  after insert or update on public.job_assignments
  for each row execute function public.sync_job_assigned_worker();
