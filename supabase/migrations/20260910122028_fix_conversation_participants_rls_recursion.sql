-- conversation_participants_select_involved_or_admin (from
-- 20260907101818_chat_notifications_audit.sql) self-joins
-- conversation_participants inside its own USING clause: evaluating the
-- policy requires re-evaluating the same policy, and Postgres throws
-- 42P17 "infinite recursion detected in policy" on every authenticated
-- read of conversations/conversation_participants/messages. Fix follows
-- the same pattern already established for is_admin() in
-- 20260907115904_fix_is_admin_security_definer_and_wrapping.sql: move the
-- self-referencing check into a SECURITY DEFINER function, whose internal
-- query bypasses RLS and therefore cannot recurse into the policy that
-- calls it.
create or replace function public.is_conversation_participant(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversation_participants
    where conversation_id = p_conversation_id and user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_conversation_participant(uuid) from public, anon;
grant execute on function public.is_conversation_participant(uuid) to authenticated;

alter policy "conversation_participants_select_involved_or_admin" on public.conversation_participants
using (
  user_id = (select auth.uid())
  or (select public.is_conversation_participant(conversation_id))
  or (select public.is_admin())
);
