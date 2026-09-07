-- I3: RLS on messages/notifications is row-level only. The sanctioned
-- write exceptions must be exactly as narrow as intended: a chat
-- participant may only ever set conversation_id/sender_id/body (not
-- created_at — backdating chat history is a real risk in an app where
-- chat is dispute evidence), and a user may only ever flip is_read on
-- their own notification (not its title/body/related_entity_id).
revoke insert on public.messages from authenticated;
grant insert (conversation_id, sender_id, body) on public.messages to authenticated;

revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
