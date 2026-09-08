-- RLS is row-level, not column-level: the "employer_verifications_insert_own"
-- policy only constrains user_id = auth.uid(), but the pre-existing
-- whole-table INSERT grant Supabase set up automatically when this table
-- was exposed lets an authenticated user INSERT into any column of their
-- own row — including status ('approved'), reviewed_by (a forged admin),
-- and reviewed_at — completely bypassing review_employer_verification()
-- and forging KYC audit data. The application only ever inserts user_id,
-- full_name_on_ktp, ktp_number, and ktp_document_path (see
-- submitEmployerVerification in lib/services/employer-verifications.ts), so
-- revoke the broad table-level grant and grant INSERT back only on those
-- four columns. status keeps its existing default of 'pending'.
revoke insert on public.employer_verifications from authenticated;
grant insert (user_id, full_name_on_ktp, ktp_number, ktp_document_path)
  on public.employer_verifications to authenticated;
