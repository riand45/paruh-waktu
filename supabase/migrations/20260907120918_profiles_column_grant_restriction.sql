-- C2 (corrected): a column-level REVOKE cannot override the pre-existing
-- whole-table SELECT grant Supabase set up automatically when this table
-- was exposed. The fix is the same pattern already used for
-- messages/notifications: revoke the broad table-level grant entirely,
-- then grant SELECT back only on the safe, non-sensitive columns. Any
-- authenticated user can still see every profile row (RLS policy is
-- unchanged, using (true)) but only these columns — phone, address,
-- latitude, longitude, and account_status become unreadable via the
-- direct client for anyone, including the row's own owner. Reading one's
-- own full profile (including these columns) must go through the
-- service-role DAL from now on.
revoke select on public.profiles from authenticated;
grant select (id, full_name, avatar_url, created_at, updated_at)
  on public.profiles to authenticated;
