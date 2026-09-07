create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.jobs (id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_conversations_updated_at
  before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, user_id)
);

create index conversation_participants_user_id_idx
  on public.conversation_participants (user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_conversation_id_idx on public.messages (conversation_id);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  type text not null,
  title text not null,
  body text,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_id_idx on public.notifications (user_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_id_idx on public.audit_logs (actor_id);

-- RLS
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "conversations_select_participant_or_admin"
on public.conversations for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = conversations.id
    and cp.user_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "conversation_participants_select_involved_or_admin"
on public.conversation_participants for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.conversation_participants cp2
    where cp2.conversation_id = conversation_participants.conversation_id
    and cp2.user_id = (select auth.uid())
  )
  or public.is_admin()
);

-- Deliberate exception (see plan header): messages support direct client
-- writes so Supabase Realtime can broadcast sends without a server round
-- trip. Authorization is still fully enforced by the participant check.
create policy "messages_select_participant_or_admin"
on public.messages for select
to authenticated
using (
  exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
    and cp.user_id = (select auth.uid())
  )
  or public.is_admin()
);

create policy "messages_insert_participant"
on public.messages for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1 from public.conversation_participants cp
    where cp.conversation_id = messages.conversation_id
    and cp.user_id = (select auth.uid())
  )
);

create policy "notifications_select_own_or_admin"
on public.notifications for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin());

-- Deliberate low-risk exception: a user may mark their own notification
-- read directly, avoiding a server round trip for a purely cosmetic flag.
create policy "notifications_update_own"
on public.notifications for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "audit_logs_select_admin_only"
on public.audit_logs for select
to authenticated
using (public.is_admin());
