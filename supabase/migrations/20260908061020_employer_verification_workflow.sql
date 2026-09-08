-- A worker may submit their own employer-verification request. All status
-- transitions happen exclusively through review_employer_verification()
-- below — there is deliberately no UPDATE policy for any role.
create policy "employer_verifications_insert_own"
on public.employer_verifications for insert
to authenticated
with check (
  user_id = (select auth.uid())
);

-- Atomically approve/reject a pending employer verification: updates the
-- request's status, grants the "employer" role on approval, and always
-- records an audit log entry — all in one transaction, so there is no
-- reachable state where one happens without the others.
create or replace function public.review_employer_verification(
  p_verification_id uuid,
  p_decision text,
  p_rejection_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_decision not in ('approved', 'rejected') then
    raise exception 'VALIDATION_ERROR: invalid decision %', p_decision;
  end if;

  if p_decision = 'rejected'
     and (p_rejection_reason is null or length(trim(p_rejection_reason)) = 0) then
    raise exception 'VALIDATION_ERROR: rejection_reason required';
  end if;

  select user_id, status into v_user_id, v_status
  from public.employer_verifications
  where id = p_verification_id
  for update;

  if v_user_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'CONFLICT: already reviewed';
  end if;

  update public.employer_verifications
  set status = p_decision,
      reviewed_at = now(),
      reviewed_by = (select auth.uid()),
      rejection_reason = case when p_decision = 'rejected' then p_rejection_reason else null end
  where id = p_verification_id;

  if p_decision = 'approved' then
    insert into public.user_roles (user_id, role, granted_by)
    values (v_user_id, 'employer', (select auth.uid()))
    on conflict (user_id, role) do nothing;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values (
    (select auth.uid()),
    case when p_decision = 'approved' then 'EMPLOYER_APPROVED' else 'EMPLOYER_REJECTED' end,
    'employer_verification',
    p_verification_id,
    case when p_decision = 'rejected' then p_rejection_reason else null end
  );
end;
$$;

revoke execute on function public.review_employer_verification from public, anon;
grant execute on function public.review_employer_verification to authenticated;
