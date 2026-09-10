-- Worker/employer conversation, created lazily on first view of a job's
-- chat page by either party. Idempotent via the existing unique
-- constraints (conversations.job_id, conversation_participants
-- (conversation_id, user_id)) rather than a row lock -- nothing computed
-- here depends on live settings the way payments/wallet crediting do.
create or replace function public.get_or_create_conversation(p_job_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employer_id uuid;
  v_assigned_worker_id uuid;
  v_conversation_id uuid;
begin
  select employer_id, assigned_worker_id into v_employer_id, v_assigned_worker_id
  from public.jobs
  where id = p_job_id;

  if v_employer_id is null then
    raise exception 'NOT_FOUND: job';
  end if;

  if (select auth.uid()) is distinct from v_employer_id
     and (select auth.uid()) is distinct from v_assigned_worker_id then
    raise exception 'FORBIDDEN';
  end if;

  if v_assigned_worker_id is null then
    raise exception 'CONFLICT: job not assigned';
  end if;

  insert into public.conversations (job_id)
  values (p_job_id)
  on conflict (job_id) do nothing;

  select id into v_conversation_id from public.conversations where job_id = p_job_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conversation_id, v_employer_id), (v_conversation_id, v_assigned_worker_id)
  on conflict (conversation_id, user_id) do nothing;

  return v_conversation_id;
end;
$$;

revoke execute on function public.get_or_create_conversation from public, anon, service_role;
grant execute on function public.get_or_create_conversation to authenticated;

-- A participant may mark their own last-read timestamp directly --
-- purely cosmetic, own-row-only, same reasoning as the already-shipped
-- notifications_update_own policy from the original Phase 1 migration.
create policy "conversation_participants_update_own"
on public.conversation_participants for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- messages.body is the first column in this app written directly by an
-- ordinary client with no Server Action in front of it (see the
-- messages_insert_participant policy from Phase 1) -- this CHECK is the
-- only backstop against an empty or unbounded-length row.
alter table public.messages
add constraint messages_body_not_blank check (length(trim(body)) > 0 and length(body) <= 2000);

-- Keep conversations.last_message_at in sync with every new message.
-- Must be security definer (unlike sync_job_assigned_worker, which is
-- security invoker): that trigger only ever fires from inside the
-- already-security-definer select_job_worker RPC, so it inherits
-- elevated privileges implicitly. This trigger fires from an ordinary
-- participant's direct insert into messages, and that participant has
-- no UPDATE grant on conversations at all.
create or replace function public.sync_conversation_last_message_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

create trigger sync_conversation_last_message_at
after insert on public.messages
for each row execute function public.sync_conversation_last_message_at();

-- Enable Realtime replication so subscribed clients receive new message
-- rows -- RLS continues to gate what each subscriber actually receives.
alter publication supabase_realtime add table public.messages;
