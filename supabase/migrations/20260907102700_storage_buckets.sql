insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880,
    array['image/jpeg', 'image/png', 'image/webp']),
  ('job-attachments', 'job-attachments', true, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('kyc-documents', 'kyc-documents', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('job-evidences', 'job-evidences', false, 20971520,
    array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']),
  ('payment-proofs', 'payment-proofs', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf']),
  ('withdrawal-proofs', 'withdrawal-proofs', false, 10485760,
    array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

-- avatars: public read (bucket flag handles this), owner-folder write.
create policy "avatars_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "avatars_update_own_folder"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- job-attachments: public read, only the job's employer may upload while
-- the DAL still governs *when* (draft/open) — this policy only enforces
-- ownership, not job status, matching "defense in depth, not duplicated
-- business logic" from the plan header.
create policy "job_attachments_insert_own_job"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'job-attachments'
  and exists (
    select 1 from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
    and j.employer_id = (select auth.uid())
  )
);

-- kyc-documents: private, owner + admin only.
create policy "kyc_documents_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'kyc-documents'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_admin()
  )
);

create policy "kyc_documents_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'kyc-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- job-evidences: private, employer + assigned worker + admin of that job.
create policy "job_evidences_select_involved_or_admin"
on storage.objects for select
to authenticated
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
    or public.is_admin()
  )
);

create policy "job_evidences_insert_assigned_worker"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'job-evidences'
  and exists (
    select 1 from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
    and j.assigned_worker_id = (select auth.uid())
  )
);

-- payment-proofs: private, employer of that payment + assigned worker + admin.
create policy "payment_proofs_select_involved_or_admin"
on storage.objects for select
to authenticated
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
    or public.is_admin()
  )
);

create policy "payment_proofs_insert_employer"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'payment-proofs'
  and exists (
    select 1 from public.payments p
    where p.id::text = (storage.foldername(name))[1]
    and p.employer_id = (select auth.uid())
  )
);

-- withdrawal-proofs: private. Only the withdrawal's owner may read it;
-- only Admin uploads it (Section 21/29: Admin performs the manual
-- transfer and attaches proof, the worker never uploads this one).
create policy "withdrawal_proofs_select_own_or_admin"
on storage.objects for select
to authenticated
using (
  bucket_id = 'withdrawal-proofs'
  and (
    exists (
      select 1 from public.withdrawals w
      where w.id::text = (storage.foldername(name))[1]
      and w.user_id = (select auth.uid())
    )
    or public.is_admin()
  )
);

create policy "withdrawal_proofs_insert_admin_only"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'withdrawal-proofs'
  and public.is_admin()
);
