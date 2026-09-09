-- Fix submit_payment_proof: p_file_path was inserted with no check that its
-- folder segment matches p_payment_id. The payment_proofs storage bucket's
-- own RLS (payment_proofs_insert_employer) already requires an uploaded
-- file's folder to equal a payment the caller owns, but this DB function
-- didn't mirror that invariant — it just trusted whatever path string was
-- passed as a parameter. A caller who owns some payment could call the RPC
-- directly (bypassing the JS service layer, which always constructs this
-- path correctly) with a p_file_path pointing at a different payment's
-- folder, misattributing an unrelated file as their own payment's proof.
create or replace function public.submit_payment_proof(
  p_payment_id uuid,
  p_file_path text,
  p_file_size_bytes bigint,
  p_transfer_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_status text;
  v_job_id uuid;
  v_proof_id uuid;
begin
  select employer_id, status, job_id into v_employer_id, v_status, v_job_id
  from public.payments
  where id = p_payment_id
  for update;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: payment';
  end if;

  if v_employer_id is distinct from (select auth.uid()) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status not in ('waiting_payment', 'rejected') then
    raise exception 'CONFLICT: payment not awaiting proof';
  end if;

  if p_file_path not like p_payment_id::text || '/%' then
    raise exception 'VALIDATION_ERROR: file_path outside payment folder';
  end if;

  insert into public.payment_proofs (payment_id, uploaded_by, file_path, file_size_bytes)
  values (p_payment_id, (select auth.uid()), p_file_path, p_file_size_bytes)
  returning id into v_proof_id;

  update public.payments
  set status = 'waiting_verification',
      transfer_date = p_transfer_date,
      rejection_reason = null
  where id = p_payment_id;

  update public.jobs
  set status = 'payment_review'
  where id = v_job_id;

  return v_proof_id;
end;
$$;

revoke execute on function public.submit_payment_proof from public, anon, service_role;
grant execute on function public.submit_payment_proof to authenticated;
