-- Admin Job Management (PRD §35): a second cancellation path for jobs
-- that never reached a verified payment. cancel_job_and_refund (Phase 10)
-- stays the only path once a payment is verified -- this RPC explicitly
-- rejects that case so a direct API call can't bypass the refund
-- requirement, mirroring this codebase's established defense-in-depth
-- pattern of re-checking state server-side rather than trusting the UI.
create or replace function public.cancel_job(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_status text;
  v_has_verified_payment boolean;
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

revoke execute on function public.cancel_job from public, anon, service_role;
grant execute on function public.cancel_job to authenticated;

-- Hardening fix (flagged by Phase 10's final review as a deferred Minor):
-- cancel_job_and_refund had no guard against being called again on an
-- already-cancelled job (only 'completed' was checked). Widen it to match
-- cancel_job's own check, so both RPCs raise the identical message for
-- "nothing left to cancel". create or replace preserves the existing
-- revoke/grant -- no need to restate them.
create or replace function public.cancel_job_and_refund(p_job_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_payment_status text;
  v_job_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select id, status into v_payment_id, v_payment_status
  from public.payments
  where job_id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: payment';
  end if;

  if v_payment_status <> 'verified' then
    raise exception 'CONFLICT: payment not verified';
  end if;

  select status into v_job_status
  from public.jobs
  where id = p_job_id
  for update;

  if v_job_status in ('cancelled', 'completed') then
    raise exception 'CONFLICT: job already cancelled or completed';
  end if;

  update public.jobs
  set status = 'cancelled', cancelled_reason = p_reason
  where id = p_job_id;

  update public.job_assignments
  set status = 'cancelled'
  where job_id = p_job_id and status = 'active';

  update public.payments
  set status = 'refund_pending'
  where id = v_payment_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'JOB_CANCELLED', 'job', p_job_id, p_reason);
end;
$$;

-- Admin Category Management (PRD §38). job_categories has no INSERT/UPDATE
-- policy at all today -- these RPCs are the only way to write to it.
create or replace function public.create_job_category(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  begin
    insert into public.job_categories (name) values (p_name) returning id into v_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: category name already exists';
  end;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'CATEGORY_CREATED', 'job_category', v_id, p_name);

  return v_id;
end;
$$;

revoke execute on function public.create_job_category from public, anon, service_role;
grant execute on function public.create_job_category to authenticated;

create or replace function public.update_job_category(p_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  begin
    update public.job_categories set name = p_name, updated_at = now() where id = p_id;
  exception
    when unique_violation then
      raise exception 'CONFLICT: category name already exists';
  end;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'CATEGORY_UPDATED', 'job_category', p_id, p_name);
end;
$$;

revoke execute on function public.update_job_category from public, anon, service_role;
grant execute on function public.update_job_category to authenticated;

create or replace function public.set_job_category_active(p_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.job_categories set is_active = p_is_active, updated_at = now() where id = p_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values (
    (select auth.uid()),
    case when p_is_active then 'CATEGORY_ACTIVATED' else 'CATEGORY_DEACTIVATED' end,
    'job_category',
    p_id,
    null
  );
end;
$$;

revoke execute on function public.set_job_category_active from public, anon, service_role;
grant execute on function public.set_job_category_active to authenticated;

-- Admin Settings (PRD §39). platform_settings has no UPDATE policy at all
-- today -- this is the only way to write to it. entity_id is left null
-- since platform_settings.key is text, not the uuid audit_logs.entity_id
-- expects; p_key in the description names which setting changed.
create or replace function public.update_platform_setting(p_key text, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.platform_settings
  set value = p_value, updated_at = now(), updated_by = (select auth.uid())
  where key = p_key;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'PLATFORM_SETTING_UPDATED', 'platform_setting', null, p_key);
end;
$$;

revoke execute on function public.update_platform_setting from public, anon, service_role;
grant execute on function public.update_platform_setting to authenticated;
