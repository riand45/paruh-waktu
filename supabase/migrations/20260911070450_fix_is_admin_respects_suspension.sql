-- Phase 10 final-review fix: is_admin() must also respect account_status,
-- otherwise a suspended admin can call activate_user on their own id
-- directly against the public Supabase API (bypassing getCurrentUser()
-- entirely, since Supabase Auth itself has no notion of account_status),
-- undoing their own suspension. This also correctly makes every other
-- existing is_admin()-gated RLS policy respect suspension, not just this
-- one RPC -- no policy changes needed elsewhere since they all delegate
-- through this one function.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = (select auth.uid())
      and ur.role = 'admin'
      and p.account_status = 'active'
  );
$$;
