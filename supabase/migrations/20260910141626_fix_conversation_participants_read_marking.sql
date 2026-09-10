-- conversation_participants_update_own (from 20260910082310_realtime_chat.sql)
-- grants any authenticated participant UPDATE on their own row, but
-- Supabase's default table-wide UPDATE grant to `authenticated` is not
-- narrowed to specific columns here -- unlike messages_insert_participant
-- and notifications_update_own, which are either column-restricted or
-- column-safe by construction. The policy's USING/WITH CHECK only pin
-- user_id; a participant can UPDATE their own row and rewrite
-- conversation_id to point at a conversation they were never added to
-- (user_id is unchanged, so both clauses still pass), gaining read access
-- to that conversation's messages via the select policy that trusts
-- conversation_participants membership. Replacing the direct-UPDATE
-- policy with a SECURITY DEFINER RPC (matching get_or_create_conversation
-- above) closes this off entirely: the function ignores any client input
-- beyond the target conversation id and always writes the caller's own
-- row. As a second, independent benefit, writing last_read_at from
-- Postgres now() instead of the caller's wall-clock Date (browser or
-- Node) removes the clock-skew gap against last_message_at, which is
-- itself set from now() by the sync_conversation_last_message_at
-- trigger -- getConversationsForCurrentUser's hasUnread comparison is
-- only meaningful when both sides come from the same clock.
drop policy "conversation_participants_update_own" on public.conversation_participants;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and user_id = (select auth.uid());
end;
$$;

revoke execute on function public.mark_conversation_read from public, anon, service_role;
grant execute on function public.mark_conversation_read to authenticated;

-- messages_body_not_blank used Postgres trim(), which only strips ASCII
-- spaces -- a body of newlines/tabs only (e.g. E'\n\n') has
-- length(trim(body)) > 0 and passed this CHECK, even though the app's
-- Zod schema (.trim(), which strips all whitespace) rejects the same
-- input client-side. Since this constraint's whole purpose is being the
-- unbypassable backstop for the one directly-client-writable column, it
-- needs to reject exactly what the client-side schema rejects: `~ '\S'`
-- requires at least one non-whitespace character, matching trim()'s
-- broader definition of blank.
alter table public.messages
drop constraint messages_body_not_blank,
add constraint messages_body_not_blank check (body ~ '\S' and length(body) <= 2000);
