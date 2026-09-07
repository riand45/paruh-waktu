-- NOTE: this migration is a verified no-op, kept only so this repo's
-- migration history matches what's actually applied on the remote
-- project. A column-level REVOKE cannot override a pre-existing
-- whole-table GRANT (Supabase grants authenticated table-wide SELECT
-- automatically when a table is exposed), so this statement changes
-- nothing. The real fix is migration
-- 20260907120918_profiles_column_grant_restriction.sql, which uses the
-- correct revoke-whole-table-then-grant-back-safe-columns pattern.
revoke select (phone, address, latitude, longitude, account_status)
  on public.profiles
  from authenticated;
