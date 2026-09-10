-- Fix withdrawal flow (20260910041646): three related issues.
--
-- 1. Precision: request_withdrawal's p_amount accepts arbitrary numeric
-- precision (e.g. 100000.005), but wallets.balance and
-- wallet_transactions.amount are numeric(12,2). The subtraction
-- v_balance := v_balance - p_amount happens at full precision before
-- storage rounds it, so the stored wallet_transactions.amount (rounded
-- from -p_amount) and the stored wallets.balance delta (rounded from the
-- full-precision subtraction) can disagree by a sub-cent amount,
-- permanently breaking the ledger invariant
-- sum(wallet_transactions.amount) == wallets.balance for that wallet.
-- Fix: reject any amount with more than 2 decimal places. This does not
-- restrict withdrawals to whole rupiah -- numeric(12,2) is the precision
-- used throughout this schema's money columns, so 2-decimal-place amounts
-- remain legitimate.
--
-- 2. Ordering: matching the fix already applied to confirm_job_completion
-- in 20260910011215, request_withdrawal and reject_withdrawal each insert
-- into wallet_transactions without setting created_at, inheriting the
-- same theoretical cross-transaction ordering ambiguity. Fix: set
-- created_at = clock_timestamp() explicitly on both inserts.
--
-- 3. Add a database-level backstop (unique partial index) so the
-- "no duplicate active withdrawal per user" invariant holds regardless of
-- which code path ever inserts into withdrawals in the future, on top of
-- request_withdrawal's existing in-function lock-and-count check.
--
-- Everything else about both functions is unchanged from 20260910041646.

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

  if p_amount <> round(p_amount, 2) then
    raise exception 'VALIDATION_ERROR: amount must have at most 2 decimal places';
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
    wallet_id, type, amount, balance_after, related_withdrawal_id, created_by, created_at
  )
  values (
    v_wallet_id, 'withdrawal', -p_amount, v_balance, v_withdrawal_id, (select auth.uid()), clock_timestamp()
  );

  update public.wallets set balance = v_balance where id = v_wallet_id;

  return v_withdrawal_id;
end;
$$;

revoke execute on function public.request_withdrawal from public, anon, service_role;
grant execute on function public.request_withdrawal to authenticated;

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
    wallet_id, type, amount, balance_after, related_withdrawal_id, description, created_by, created_at
  )
  values (
    v_wallet_id, 'refund', v_amount, v_balance, p_withdrawal_id,
    'Withdrawal rejected: refund', (select auth.uid()), clock_timestamp()
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

-- Database-level backstop: at most one active (pending/processing)
-- withdrawal per user, regardless of which code path inserts into
-- withdrawals in the future. request_withdrawal's lock-and-count check
-- remains the primary mechanism; this index makes the invariant hold
-- even if that check is ever bypassed.
create unique index withdrawals_one_active_per_user_idx on public.withdrawals (user_id) where status in ('pending', 'processing');
