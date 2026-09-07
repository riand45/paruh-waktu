-- Task 8 DoD verification found: avatar re-upload (Storage `update`/`upsert`)
-- fails with "new row violates row-level security policy" even though the
-- INSERT and UPDATE policy expressions are correct and identical. Root cause:
-- the avatars bucket had no `for select` policy on storage.objects — every
-- other bucket in this schema has one (see kyc_documents_select_own_or_admin
-- etc.), but avatars only had insert+update, on the mistaken assumption that
-- the bucket's `public = true` flag alone covers reads. That flag only
-- controls the unauthenticated `/storage/v1/object/public/...` CDN path; it
-- does not grant the `authenticated` role RLS visibility into storage.objects
-- rows. The Storage API's update/upsert path needs to SELECT the existing
-- row (as the authenticated user) to know whether to insert or update it —
-- with no visible row, that internal check fails and the write is rejected.
-- Confirmed independently: `.list()` on one's own avatar folder also
-- returned empty immediately after a successful insert, for the same reason.
--
-- Corrected below: the first version of this policy (applied live, then
-- superseded here) granted SELECT to `public`/`anon` on every row in the
-- bucket. That is too broad — anyone holding the publishable key can call
-- `POST /storage/v1/object/list/avatars` and enumerate every object in the
-- bucket (user UUIDs, filenames, sizes, timestamps), with no ownership
-- check at all. Public *downloads* are unaffected by narrowing this: for a
-- `public = true` bucket, `/storage/v1/object/public/...` bypasses RLS
-- entirely. Only the *owner* needs SELECT visibility here, because the
-- Storage API's internal existence-check during upsert/update (see above)
-- runs as the uploading user against their own path — so scoping SELECT to
-- the owner's own folder is sufficient for uploads/updates/list to keep
-- working, while removing the enumeration exposure.
drop policy if exists "avatars_select_public" on storage.objects;

create policy "avatars_select_own_folder"
on storage.objects for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
