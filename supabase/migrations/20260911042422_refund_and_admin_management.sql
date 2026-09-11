-- Refund (PRD §29): Admin cancels a job whose payment is already verified
-- but not yet completed, then records the manual transfer back to the
-- employer. No wallet_transactions row -- employers have no wallet in
-- this schema; the payments row itself is the recorded transaction.

alter table public.payments
  add column refunded_by uuid references public.profiles (id),
  add column refund_transfer_proof_path text,
  add column refunded_at timestamptz;

-- payments.status had no explicit constraint name in its original inline
-- `check (...)`, so Postgres auto-named it <table>_<column>_check. If
-- this DROP fails with "constraint does not exist", find the actual name
-- via the Supabase dashboard's Table Editor > payments > a failed
-- migration's error message names the real constraint -- then substitute
-- it below and re-run.
alter table public.payments
  drop constraint payments_status_check,
  add constraint payments_status_check check (
    status in (
      'waiting_payment', 'waiting_verification', 'verified', 'rejected',
      'refund_pending', 'refunded'
    )
  );

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

  if v_job_status = 'completed' then
    raise exception 'CONFLICT: job already completed';
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

revoke execute on function public.cancel_job_and_refund from public, anon, service_role;
grant execute on function public.cancel_job_and_refund to authenticated;

create or replace function public.mark_refund_paid(p_payment_id uuid, p_transfer_proof_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select status into v_status
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'refund_pending' then
    raise exception 'CONFLICT: refund not pending';
  end if;

  if p_transfer_proof_path not like p_payment_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside payment folder';
  end if;

  update public.payments
  set status = 'refunded',
      refund_transfer_proof_path = p_transfer_proof_path,
      refunded_by = (select auth.uid()),
      refunded_at = now()
  where id = p_payment_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'REFUND_PAID', 'payment', p_payment_id, null);
end;
$$;

revoke execute on function public.mark_refund_paid from public, anon, service_role;
grant execute on function public.mark_refund_paid to authenticated;

-- Admin User Management (PRD §33): suspend/activate. profiles.account_status
-- already exists (Phase 1) but nothing has ever written to it -- these are
-- the first writers. Kept as RPCs (not a bare service-role .update()) so
-- every privileged state change in this app keeps writing audit_logs from
-- inside the same transaction, same as every RPC above.
create or replace function public.suspend_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id = (select auth.uid()) then
    raise exception 'FORBIDDEN: cannot suspend own account';
  end if;

  update public.profiles set account_status = 'suspended' where id = p_user_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'USER_SUSPENDED', 'profile', p_user_id, null);
end;
$$;

revoke execute on function public.suspend_user from public, anon, service_role;
grant execute on function public.suspend_user to authenticated;

create or replace function public.activate_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  update public.profiles set account_status = 'active' where id = p_user_id;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'USER_ACTIVATED', 'profile', p_user_id, null);
end;
$$;

revoke execute on function public.activate_user from public, anon, service_role;
grant execute on function public.activate_user to authenticated;

-- refund-proofs storage bucket: private, admin-only upload, readable by
-- the payment's own employer or an admin -- copied verbatim from
-- withdrawal-proofs' shape (supabase/migrations/20260907102700_storage_buckets.sql),
-- substituting payments/employer_id for withdrawals/user_id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('refund-proofs', 'refund-proofs', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "refund_proofs_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'refund-proofs'
  and (
    exists (
      select 1 from public.payments p
      where p.id::text = (storage.foldername(name))[1]
      and p.employer_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

create policy "refund_proofs_insert_admin_only"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'refund-proofs'
  and public.is_admin()
);
