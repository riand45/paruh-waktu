-- I6: the original bucket seed used "on conflict do nothing" (first-writer
-- wins) — make this migration authoritative so re-running the seed always
-- enforces the correct public/size/mime settings, even if a bucket was
-- pre-created out-of-band with different settings.
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
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
