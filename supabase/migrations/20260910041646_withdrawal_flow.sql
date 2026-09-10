-- Worker requests a withdrawal from their available wallet balance.
-- Locks the caller's wallet first, which serializes concurrent calls from
-- the same user and makes the duplicate-request check below race-free.
-- Immediately debits the wallet (a hold, not deferred to payout), so
-- "available balance" always excludes money already promised to a
-- pending/processing request.
create or replace function public.request_withdrawal(
  p_amount numeric,
  p_bank_name text,
  p_account_number text,
  p_account_holder_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wallet_id uuid;
  v_balance numeric;
  v_existing_count int;
  v_withdrawal_id uuid;
begin
  select id, balance into v_wallet_id, v_balance
  from public.wallets
  where user_id = (select auth.uid())
  for update;

  if not found then
    raise exception 'VALIDATION_ERROR: insufficient balance';
  end if;

  select count(*) into v_existing_count
  from public.withdrawals
  where user_id = (select auth.uid())
  and status in ('pending', 'processing');

  if v_existing_count > 0 then
    raise exception 'CONFLICT: an active withdrawal request already exists';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > v_balance then
    raise exception 'VALIDATION_ERROR: amount exceeds available balance';
  end if;

  if p_bank_name is null or length(trim(p_bank_name)) = 0
     or p_account_number is null or length(trim(p_account_number)) = 0
     or p_account_holder_name is null or length(trim(p_account_holder_name)) = 0 then
    raise exception 'VALIDATION_ERROR: bank details required';
  end if;

  insert into public.withdrawals (user_id, amount, bank_name, account_number, account_holder_name, status)
  values ((select auth.uid()), p_amount, p_bank_name, p_account_number, p_account_holder_name, 'pending')
  returning id into v_withdrawal_id;

  v_balance := v_balance - p_amount;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_after, related_withdrawal_id, created_by
  )
  values (
    v_wallet_id, 'withdrawal', -p_amount, v_balance, v_withdrawal_id, (select auth.uid())
  );

  update public.wallets set balance = v_balance where id = v_wallet_id;

  return v_withdrawal_id;
end;
$$;

revoke execute on function public.request_withdrawal from public, anon, service_role;
grant execute on function public.request_withdrawal to authenticated;

-- Admin moves a pending withdrawal into processing, acknowledging they
-- are now performing the manual bank transfer.
create or replace function public.process_withdrawal(p_withdrawal_id uuid)
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
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'CONFLICT: withdrawal not pending';
  end if;

  update public.withdrawals set status = 'processing' where id = p_withdrawal_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'WITHDRAWAL_PROCESSING', 'withdrawal', p_withdrawal_id, null);
end;
$$;

revoke execute on function public.process_withdrawal from public, anon, service_role;
grant execute on function public.process_withdrawal to authenticated;

-- Admin rejects a still-pending withdrawal, refunding the held amount
-- back to the requester's wallet. Only available from 'pending' -- once
-- Admin has moved a request to 'processing', the only forward path is
-- mark_withdrawal_paid (no reject-from-processing path in this phase).
create or replace function public.reject_withdrawal(
  p_withdrawal_id uuid,
  p_rejection_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_amount numeric;
  v_status text;
  v_wallet_id uuid;
  v_balance numeric;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_rejection_reason is null or length(trim(p_rejection_reason)) = 0 then
    raise exception 'VALIDATION_ERROR: rejection_reason required';
  end if;

  select user_id, amount, status into v_user_id, v_amount, v_status
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'pending' then
    raise exception 'CONFLICT: withdrawal not pending';
  end if;

  select id, balance into v_wallet_id, v_balance
  from public.wallets
  where user_id = v_user_id
  for update;

  v_balance := v_balance + v_amount;

  insert into public.wallet_transactions (
    wallet_id, type, amount, balance_after, related_withdrawal_id, description, created_by
  )
  values (
    v_wallet_id, 'refund', v_amount, v_balance, p_withdrawal_id,
    'Withdrawal rejected: refund', (select auth.uid())
  );

  update public.wallets set balance = v_balance where id = v_wallet_id;

  update public.withdrawals
  set status = 'rejected',
      rejection_reason = p_rejection_reason,
      processed_by = (select auth.uid()),
      processed_at = now()
  where id = p_withdrawal_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'WITHDRAWAL_REJECTED', 'withdrawal', p_withdrawal_id, p_rejection_reason);
end;
$$;

revoke execute on function public.reject_withdrawal from public, anon, service_role;
grant execute on function public.reject_withdrawal to authenticated;

-- Admin records the manual transfer proof and marks a processing
-- withdrawal as paid. No wallet change here -- the amount was already
-- debited at request time by request_withdrawal.
create or replace function public.mark_withdrawal_paid(
  p_withdrawal_id uuid,
  p_transfer_proof_path text
)
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
  from public.withdrawals
  where id = p_withdrawal_id
  for update;

  if not found then
    raise exception 'NOT_FOUND';
  end if;

  if v_status <> 'processing' then
    raise exception 'CONFLICT: withdrawal not processing';
  end if;

  if p_transfer_proof_path not like p_withdrawal_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside withdrawal folder';
  end if;

  update public.withdrawals
  set status = 'paid',
      transfer_proof_path = p_transfer_proof_path,
      processed_by = (select auth.uid()),
      processed_at = now()
  where id = p_withdrawal_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, description)
  values ((select auth.uid()), 'WITHDRAWAL_PAID', 'withdrawal', p_withdrawal_id, null);
end;
$$;

revoke execute on function public.mark_withdrawal_paid from public, anon, service_role;
grant execute on function public.mark_withdrawal_paid to authenticated;
