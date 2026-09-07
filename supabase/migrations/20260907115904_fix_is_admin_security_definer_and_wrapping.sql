-- C1: is_admin() must be SECURITY DEFINER, not SECURITY INVOKER, or its own
-- inner query re-triggers the RLS policies that call it (infinite recursion
-- once more than one user exists in user_roles). SECURITY DEFINER runs the
-- inner query as the function's owner, which is exempt from RLS, so the
-- policy that calls this function is never re-entered.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- I5: wrap every existing public.is_admin() call the same way auth.uid()
-- is already wrapped, so the planner treats it as an InitPlan (evaluated
-- once per statement) instead of re-evaluating it per candidate row.
alter policy "user_roles_select_own_or_admin" on public.user_roles
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

alter policy "employer_verifications_select_own_or_admin" on public.employer_verifications
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

alter policy "job_categories_select_active_or_admin" on public.job_categories
using ( is_active = true or (select public.is_admin()) );

alter policy "jobs_select_open_or_involved_or_admin" on public.jobs
using (
  status = 'open'
  or employer_id = (select auth.uid())
  or assigned_worker_id = (select auth.uid())
  or (select public.is_admin())
);

alter policy "job_applications_select_involved_or_admin" on public.job_applications
using (
  worker_id = (select auth.uid())
  or exists (
    select 1 from public.jobs j
    where j.id = job_applications.job_id
    and j.employer_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "job_assignments_select_involved_or_admin" on public.job_assignments
using (
  worker_id = (select auth.uid())
  or exists (
    select 1 from public.jobs j
    where j.id = job_assignments.job_id
    and j.employer_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "job_attachments_select_visible_job_or_admin" on public.job_attachments
using (
  exists (
    select 1 from public.jobs j
    where j.id = job_attachments.job_id
    and (
      j.status = 'open'
      or j.employer_id = (select auth.uid())
      or j.assigned_worker_id = (select auth.uid())
    )
  )
  or (select public.is_admin())
);

alter policy "job_evidences_select_involved_or_admin" on public.job_evidences
using (
  exists (
    select 1 from public.jobs j
    where j.id = job_evidences.job_id
    and (
      j.employer_id = (select auth.uid())
      or j.assigned_worker_id = (select auth.uid())
    )
  )
  or (select public.is_admin())
);

alter policy "payments_select_involved_or_admin" on public.payments
using (
  employer_id = (select auth.uid())
  or exists (
    select 1 from public.jobs j
    where j.id = payments.job_id
    and j.assigned_worker_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "payment_proofs_select_involved_or_admin" on public.payment_proofs
using (
  exists (
    select 1 from public.payments p
    where p.id = payment_proofs.payment_id
    and (
      p.employer_id = (select auth.uid())
      or exists (
        select 1 from public.jobs j
        where j.id = p.job_id
        and j.assigned_worker_id = (select auth.uid())
      )
    )
  )
  or (select public.is_admin())
);

alter policy "wallets_select_own_or_admin" on public.wallets
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

alter policy "withdrawals_select_own_or_admin" on public.withdrawals
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

alter policy "wallet_transactions_select_own_or_admin" on public.wallet_transactions
using (
  exists (
    select 1 from public.wallets w
    where w.id = wallet_transactions.wallet_id
    and w.user_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "conversations_select_participant_or_admin" on public.conversations
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id
    and cp.user_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "conversation_participants_select_involved_or_admin" on public.conversation_participants
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.conversation_participants cp2
    where cp2.conversation_id = conversation_participants.conversation_id
    and cp2.user_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "messages_select_participant_or_admin" on public.messages
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
    and cp.user_id = (select auth.uid())
  )
  or (select public.is_admin())
);

alter policy "notifications_select_own_or_admin" on public.notifications
using ( user_id = (select auth.uid()) or (select public.is_admin()) );

alter policy "audit_logs_select_admin_only" on public.audit_logs
using ( (select public.is_admin()) );

-- Storage policies also call public.is_admin() unwrapped.
alter policy "kyc_documents_select_own_or_admin" on storage.objects
using (
  bucket_id = 'kyc-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select public.is_admin())
  )
);

alter policy "job_evidences_select_involved_or_admin" on storage.objects
using (
  bucket_id = 'job-evidences'
  and (
    exists (
      select 1 from public.jobs j
      where j.id::text = (storage.foldername(name))[1]
      and (
        j.employer_id = (select auth.uid())
        or j.assigned_worker_id = (select auth.uid())
      )
    )
    or (select public.is_admin())
  )
);

alter policy "payment_proofs_select_involved_or_admin" on storage.objects
using (
  bucket_id = 'payment-proofs'
  and (
    exists (
      select 1 from public.payments p
      where p.id::text = (storage.foldername(name))[1]
      and (
        p.employer_id = (select auth.uid())
        or exists (
          select 1 from public.jobs j
          where j.id = p.job_id
          and j.assigned_worker_id = (select auth.uid())
        )
      )
    )
    or (select public.is_admin())
  )
);

alter policy "withdrawal_proofs_select_own_or_admin" on storage.objects
using (
  bucket_id = 'withdrawal-proofs'
  and (
    exists (
      select 1 from public.withdrawals w
      where w.id::text = (storage.foldername(name))[1]
      and w.user_id = (select auth.uid())
    )
    or (select public.is_admin())
  )
);

alter policy "withdrawal_proofs_insert_admin_only" on storage.objects
with check (
  bucket_id = 'withdrawal-proofs'
  and (select public.is_admin())
);
