# Realtime Chat — Design

## 1. Purpose

Implement the PRD's "STEP 11 — Realtime Chat" (job-scoped conversations between an employer and their assigned worker, with realtime delivery and read/unread state) — the next unbuilt piece of the core business flow after Phase 8's withdrawal processing. Matches PRD §30-31 and the Implementation Prompt's §23/STEP 11.

Core shape (PRD §31):

```
Employer
   ↕
 Chat
   ↕
Worker
```

One conversation per job, created once a worker is assigned, available for the rest of the job's life (no close/archive concept anywhere in the schema).

## 2. Out of scope (explicitly deferred)

- **The `notifications` table** (confirmed with the user) — this phase writes no notification rows; that table stays untouched, exactly like every other pre-built-but-unused table this project has deliberately left alone phase-by-phase (withdrawals in Phase 6/7, refunds in Phase 8).
- **Admin visibility into chat UI.** The existing `conversations`/`conversation_participants`/`messages` SELECT policies already include an `is_admin()` clause (from Phase 1), so an Admin *could* query these tables, but no admin page is built in this phase — PRD §31's access rule ("user hanya dapat melihat conversation yang memang melibatkan dirinya") is about participants, and nothing in STEP 11/12 asks for an admin chat-moderation UI.
- **Message editing/deletion, attachments, typing indicators, read receipts beyond a per-conversation last-read timestamp.** PRD §30's feature list is exactly: conversation list, message list, send, receive realtime, timestamp, read/unread — nothing beyond that.
- **Pagination on the message list.** Matches this codebase's existing convention (wallet transactions, payment proofs, evidences — none of them paginate yet).

## 3. What already exists (Phase 1), reused as-is

All schema for this phase was created in Phase 1's `supabase/migrations/20260907101818_chat_notifications_audit.sql` — no new tables.

- **`conversations`**: `id, job_id (unique), last_message_at, created_at, updated_at`. SELECT-only RLS (`conversations_select_participant_or_admin`).
- **`conversation_participants`**: `id, conversation_id, user_id, last_read_at, created_at`, unique on `(conversation_id, user_id)`. SELECT-only RLS.
- **`messages`**: `id, conversation_id, sender_id, body, created_at`. RLS already includes **both** SELECT (`messages_select_participant_or_admin`) **and** INSERT (`messages_insert_participant`, requiring `sender_id = auth.uid()` and participant membership) — a deliberate exception baked in from Phase 1 specifically so Realtime can broadcast a send without a server round trip. This phase is the first to actually exercise that exception: **messages are inserted directly by the client, not through a `SECURITY DEFINER` RPC.**
- **`notifications`/`audit_logs`**: exist, untouched (see §2).

What's missing and needs a new migration: an RPC to create a conversation (no INSERT policy exists on `conversations`/`conversation_participants` themselves), a way for a participant to update their own `last_read_at`, Realtime replication enabled on `messages`, and a not-blank/max-length guard on `messages.body` (see §4 — this is the first table in the app writable directly by an ordinary client with no Server Action in front of it, so the database constraint is the only enforcement point that can't be bypassed).

## 4. Database changes (new migration)

### 4.1 `get_or_create_conversation(p_job_id uuid) returns uuid`

Idempotent by construction (via the existing unique constraints), so no row lock is needed — unlike `get_or_create_payment`/`confirm_job_completion`, nothing here is a computed financial value that a lock would need to protect:

1. Read `jobs.employer_id`/`jobs.assigned_worker_id` for `p_job_id`. `NOT_FOUND` if the job doesn't exist.
2. `FORBIDDEN` unless the caller is the employer or the assigned worker (`(select auth.uid())` compared with `is distinct from` against both).
3. `CONFLICT: job not assigned` if `assigned_worker_id is null`.
4. `insert into conversations (job_id) values (p_job_id) on conflict (job_id) do nothing`, then `select id` (whether just-inserted or pre-existing) into a variable.
5. `insert into conversation_participants (conversation_id, user_id) values (<id>, employer_id), (<id>, assigned_worker_id) on conflict (conversation_id, user_id) do nothing`.
6. Return the conversation id.

`security definer`, `set search_path = ''`, `revoke execute ... from public, anon, service_role; grant execute ... to authenticated;` — same as every prior RPC.

### 4.2 `conversation_participants` UPDATE policy (own row only)

```sql
create policy "conversation_participants_update_own"
on public.conversation_participants for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
```

Mirrors the already-shipped `notifications_update_own` policy's exact reasoning from the same original migration: a low-risk, purely-cosmetic own-row flag (`last_read_at`) doesn't need a server round trip.

### 4.3 `messages.body` guard

```sql
alter table public.messages
add constraint messages_body_not_blank check (length(trim(body)) > 0 and length(body) <= 2000);
```

Since `messages` INSERT bypasses every Server Action/service-layer check this app normally relies on, this constraint is the only backstop against an empty or unbounded-length row reaching the table. Client-side validation (a shared Zod schema, §5.1) is the primary gate; this is defense in depth for the one path in this codebase where the client writes directly.

### 4.4 Keep `conversations.last_message_at` in sync

```sql
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
```

Must be `security definer` (unlike the existing `sync_job_assigned_worker` trigger, which is `security invoker`): that trigger only ever fires from inside the already-`SECURITY DEFINER` `select_job_worker` RPC, so it inherits elevated privileges implicitly. This trigger fires from an ordinary participant's **direct** insert into `messages`, and that participant has no UPDATE grant on `conversations` at all — the trigger must supply its own privilege to write the denormalized timestamp.

### 4.5 Enable Realtime on `messages`

```sql
alter publication supabase_realtime add table public.messages;
```

Nothing in this app has needed Realtime replication before now. RLS continues to gate what each subscribed client actually receives — enabling replication doesn't widen access, since Postgres Changes replication for a given subscriber is filtered through that subscriber's own row-level security.

## 5. Application layer

### 5.1 Validation (`lib/validations/chat.ts`)

```ts
export const MessageBodySchema = z.object({
  body: z.string().trim().min(1, { error: 'Pesan tidak boleh kosong.' }).max(2000, { error: 'Pesan maksimal 2000 karakter.' }),
})
```

Used by the client-side send form before attempting the insert — the one place in this codebase a Zod schema validates input for a *direct* client write rather than a Server Action's `FormData`.

### 5.2 Service layer (`lib/services/chat.ts`, server-only, auth-context client only)

- `getOrCreateConversationForJob(jobId): Promise<{ id: string }>` — calls `get_or_create_conversation`.
- `getConversationsForCurrentUser(): Promise<ConversationSummary[]>` — reads the caller's `conversation_participants` rows, then the corresponding `conversations`/`jobs`/other-participant `profiles` rows via the established two-query-plus-`Map` pattern (no embeds), computing `hasUnread = conversations.last_message_at is not null && (my last_read_at is null || conversations.last_message_at > my last_read_at)` per conversation. This formula only stays correct if sending a message also advances *my own* `last_read_at` (§5.3 — the client calls `markConversationRead` right after a successful send, not only on opening the thread); otherwise a conversation where I sent the newest message would show as unread to myself the next time I view the list. Sorted by `last_message_at` descending (most recent activity first), conversations with no messages yet last.
- `getConversationDetail(jobId): Promise<ConversationDetail | null>` — verifies the caller is the job's employer or assigned worker (via `getJobDetail`), calls `getOrCreateConversationForJob` (lazy creation on every view, mirroring `get_or_create_payment`'s precedent), then reads the conversation's `messages` (ascending) and the other participant's name.
- `markConversationRead(conversationId): Promise<void>` — a plain `update` on the caller's own `conversation_participants` row (`last_read_at = now()`), relying on the new §4.2 policy — no RPC.

Sending a message and subscribing to Realtime updates are **not** in this file (it's `server-only`) — both need the browser client and live in a client component (§5.3).

### 5.3 Routes

- **New `app/chat/page.tsx`** — "Percakapan Saya": lists every conversation the current user participates in (job title, other party's name, last message time, an unread dot), each linking to `/jobs/[id]/chat`. Requires auth only.
- **New `app/jobs/[id]/chat/page.tsx`** — `notFound()` unless the viewer is the job's employer or assigned worker, or the job isn't assigned yet. Calls `getConversationDetail` (lazily creating the conversation) and `markConversationRead`, then renders a client component with the initial message list.
- **New `app/jobs/[id]/chat/chat-thread.tsx`** (`'use client'`) — subscribes to `postgres_changes` INSERT events on `messages` filtered to this `conversation_id` via the browser client (`lib/supabase/client.ts`), appending new rows to local state; renders the message list (auto-scroll to newest) and a send form that validates with `MessageBodySchema` and inserts directly into `messages` via the browser client.
- **`app/jobs/[id]/page.tsx`** (existing) — add a "Chat" link, visible to both the employer and the assigned worker (mirroring Phase 7's completion-link precedent of reaching both parties, not owner-only like Phase 6's payment link), once `job.assignedWorkerId` is set — regardless of any later status, since chat never closes.

## 6. Error handling

| Situation | Error |
|---|---|
| Non-employer/non-assigned-worker calls `get_or_create_conversation` | `FORBIDDEN` |
| Called before the job has an assigned worker | `CONFLICT` |
| A non-participant's direct `messages` insert | blocked by RLS (surfaces as a generic Postgres/PostgREST permission error; the UI never offers the send form to a non-participant in the first place) |
| A blank or >2000-char message body | blocked client-side by `MessageBodySchema` first; the `messages_body_not_blank` CHECK constraint is the backstop if that's ever bypassed |
| Non-participant visits `/jobs/[id]/chat` | `notFound()` |
| Any authenticated user visits `/chat` | always 200 — shows only their own conversations (never `notFound()`, since everyone might have zero-or-more) |

## 7. Testing

- `lib/validations/chat.test.ts` — unit tests for `MessageBodySchema` (valid message, rejects blank/whitespace-only, rejects over 2000 chars, accepts exactly 2000), matching every prior phase's validation-test convention.
- No automated tests for the service layer, the RPC, or the trigger (DB-dependent, no test harness in this repo, same as every prior phase) — verified via a genuinely-executed Playwright walkthrough with **two real browser contexts messaging each other**, covering: lazy conversation creation on first view (idempotent on reload), a message sent by one party appearing in the other party's already-open tab with no manual refresh, the unread indicator on `/chat` before and after opening a conversation, the empty/blank-message client-side rejection, and a non-participant's `notFound()` on `/jobs/[id]/chat`.

## 8. Open assumptions (documented here as the safest MVP default, revisit later)

- **Conversation creation is lazy**, triggered by either party's first view of the job's chat page — mirroring `get_or_create_payment`'s established precedent, since nothing in the PRD names a distinct "start chat" action, and this avoids touching the already-shipped `select_job_worker` RPC.
- **Chat is available for the job's entire remaining lifetime once assigned**, with no closing/archiving — the schema has no status column for it and the PRD names no such rule.
- **Sending a message is a direct client-side `INSERT`, not a Server Action or RPC** — this was Phase 1's own deliberate design (visible in that migration's comments), and this phase is the first to build on it rather than add a redundant server round trip.
- **Realtime uses Postgres Changes (RLS-filtered table replication), not Broadcast** — the simpler, more idiomatic fit given `messages`' SELECT RLS already expresses exactly the authorization Realtime needs to respect, and the Implementation Prompt names "Supabase Realtime" generically without mandating Broadcast.
- **Unread is a boolean per conversation** (has the other party sent something since my last read), not an exact unread count — PRD §30 says "Read/unread," not a count, and a boolean is one comparison instead of a `count(*)` per conversation on the list page.
