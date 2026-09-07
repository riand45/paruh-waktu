create or replace function public.check_job_evidence_assignment_consistency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.job_id is distinct from (
    select job_id from public.job_assignments where id = new.assignment_id
  ) then
    raise exception 'job_evidences.job_id must match job_assignments.job_id for the given assignment_id';
  end if;
  return new;
end;
$$;

create trigger check_job_evidences_consistency
  before insert or update on public.job_evidences
  for each row execute function public.check_job_evidence_assignment_consistency();
