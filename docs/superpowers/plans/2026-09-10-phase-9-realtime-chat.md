# Phase 9 — Realtime Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employer and their assigned worker message each other in a job-scoped conversation, with realtime delivery (no manual refresh) and a read/unread indicator, plus a conversation-list page.

**Architecture:** `conversations`/`conversation_participants`/`messages` already exist (Phase 1 migration) with correct SELECT RLS, and `messages` already has a deliberate direct-client INSERT policy from Phase 1 — this phase is the first to build on it: **sending a message is a plain client-side `INSERT`, not a `SECURITY DEFINER` RPC or Server Action**, and delivery to the other party is Supabase Realtime's Postgres Changes replication (RLS-filtered) rather than a page reload. One new `SECURITY DEFINER` RPC (`get_or_create_conversation`) lazily creates the conversation, mirroring `get_or_create_payment`'s precedent but without a row lock (idempotent via existing unique constraints instead, since nothing here is a computed financial value). A new own-row UPDATE policy on `conversation_participants` lets a participant mark their own `last_read_at` directly, and a `security definer` trigger keeps `conversations.last_message_at` in sync on every insert (needed specifically because ordinary participants have no UPDATE grant on `conversations` themselves).

**Tech Stack:** Next.js 16.3.4 (Server Components for data, a `'use client'` component for realtime + sending), Zod v4, Supabase (auth-context client for all server-side reads/RPCs; the **browser client** `lib/supabase/client.ts` for the first time in this codebase, used only in the chat-thread client component for the realtime subscription and the direct message insert), Supabase CLI (`npx supabase db push`), Vitest, Playwright (already installed on this machine — reuse it, don't reinstall).

**Spec:** `docs/superpowers/specs/2026-09-10-realtime-chat-design.md` (this phase's approved design), `docs/PRD — PARUH WAKTU MVP.md` §30-31, `docs/IMPLEMENTATION PROMPT — PARUH WAKTU MVP.md` §23 and STEP 11, and Phase 6/7/8's plans for schema and conventions this phase builds on.

## Global Constraints

- `conversations`/`conversation_participants` have SELECT-only RLS and no INSERT policy — creation goes only through `get_or_create_conversation`, never a service-role client, never a plain client-side insert.
- **`messages` is the one exception to "every write goes through a `SECURITY DEFINER` function"** — it already has a client-writable INSERT policy from Phase 1 (`sender_id = auth.uid()` + participant membership). This phase sends messages via a direct `.from('messages').insert(...)` call using the auth-context **browser** client, never a Server Action, never an RPC.
- **`get_or_create_conversation` needs no row lock** — it's idempotent purely via `conversations.job_id`'s unique constraint and `conversation_participants`' unique `(conversation_id, user_id)` constraint, using `insert ... on conflict ... do nothing` (same idiom already used by `confirm_job_completion`'s lazy wallet creation). Do not add a `for update` lock — there is nothing computed here that a lock would need to protect.
- **The `sync_conversation_last_message_at` trigger function must be `security definer`** (unlike `sync_job_assigned_worker`, which is `security invoker`) — it fires from an ordinary participant's direct `messages` insert, and that participant has no UPDATE grant on `conversations` at all, so the trigger must supply its own privilege.
- The new `conversation_participants` UPDATE policy is scoped to `user_id = (select auth.uid())` only (both `using` and `with check`) — a participant may only ever touch their own `last_read_at`.
- `messages.body` gets a `CHECK (length(trim(body)) > 0 and length(body) <= 2000)` constraint — the only enforcement point that can't be bypassed, since this table has no Server Action in front of it. Client-side `MessageBodySchema` validation is the primary gate; this is defense in depth.
- Realtime replication must be enabled for `messages` (`alter publication supabase_realtime add table public.messages;`) — nothing in this repo has needed this before.
- **After a successful send, the client must also update its own `last_read_at`** (via the same own-row UPDATE policy, a direct client call — no RPC), not only on opening the thread. Skipping this makes a conversation where you sent the most recent message incorrectly show as "unread" to yourself on the conversation list.
- A conversation is available for the rest of the job's life once `assigned_worker_id` is set — no status-based gating, no closing/archiving.
- The `notifications` table is not touched by this phase.
- Every Server Component re-verifies participant/employer/assigned-worker membership itself via the service layer — never rely on `proxy.ts`'s redirect alone.

---

### Task 1: Validation schema (Zod) for chat messages

**Files:**
- Create: `lib/validations/chat.ts`
- Create: `lib/validations/chat.test.ts`

**Interfaces:**
- Produces: `MessageBodySchema` — consumed by Task 4's chat-thread client component (the one place in this codebase a Zod schema validates input for a *direct* client write rather than a Server Action's `FormData`).

- [ ] **Step 1: Write the failing tests**

Create `lib/validations/chat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MessageBodySchema } from './chat'

describe('MessageBodySchema', () => {
  it('accepts a normal message', () => {
    const result = MessageBodySchema.safeParse({ body: 'Halo, kapan bisa mulai kerja?' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty message', () => {
    const result = MessageBodySchema.safeParse({ body: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a whitespace-only message', () => {
    const result = MessageBodySchema.safeParse({ body: '   ' })
    expect(result.success).toBe(false)
  })

  it('accepts a message exactly 2000 characters long', () => {
    const result = MessageBodySchema.safeParse({ body: 'a'.repeat(2000) })
    expect(result.success).toBe(true)
  })

  it('rejects a message over 2000 characters long', () => {
    const result = MessageBodySchema.safeParse({ body: 'a'.repeat(2001) })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run lib/validations/chat.test.ts
```

Expected: FAIL — `Cannot find module './chat'`.

- [ ] **Step 3: Implement the schema**

Create `lib/validations/chat.ts`:

```ts
import { z } from 'zod'

export const MessageBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, { error: 'Pesan tidak boleh kosong.' })
    .max(2000, { error: 'Pesan maksimal 2000 karakter.' }),
})

export type MessageBodyInput = z.infer<typeof MessageBodySchema>
```

- [ ] **Step 4: Run the tests again and confirm they pass**

```bash
npx vitest run lib/validations/chat.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/validations/chat.ts lib/validations/chat.test.ts
git commit -m "feat: add Zod validation schema for chat messages"
```

---

### Task 2: Database migration — conversation RPC, read-tracking policy, message guard, realtime

**Files:**
- Create: `supabase/migrations/<timestamp>_realtime_chat.sql`

**Interfaces:**
- Produces: `public.get_or_create_conversation(p_job_id uuid) returns uuid` — consumed by Task 3's service layer.
- Consumes: `public.jobs`, `public.conversations`, `public.conversation_participants`, `public.messages` (all Phase 1).

- [ ] **Step 1: Re-establish the Supabase CLI link**

```bash
npx supabase link --project-ref msvhvkthvwdabwlgmwyi
```

(The CLI should already have a stored login session — if it prompts for a database password, use the one from the Supabase dashboard.)

- [ ] **Step 2: Verify the link**

```bash
npx supabase migration list
```

Expected: lists every migration through `20260910055455_fix_withdrawal_precision_and_ordering.sql` as applied on both `Local` and `Remote`. **If anything is missing from Remote, stop and investigate before continuing.**

- [ ] **Step 3: Create the migration file**

```bash
npx supabase migration new realtime_chat
```

Note the generated filename (e.g. `supabase/migrations/20260910120000_realtime_chat.sql`) — edit that exact file in the next step.

- [ ] **Step 4: Write the migration**

Replace the file's contents with:

```sql
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
```

- [ ] **Step 5: Push the migration to the remote project**

```bash
npx supabase db push
```

Expected: prompts to confirm applying 1 new migration, then `Finished supabase db push`.

- [ ] **Step 6: Verify**

```bash
npx supabase migration list
```

Expected: the new `realtime_chat` migration now shows as applied on both `Local` and `Remote`.

- [ ] **Step 7: Regenerate database types**

```bash
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
```

Expected: the file updates — diff should show `get_or_create_conversation` appear under the `public` schema's `Functions` block, alongside the existing entries. No table gains new columns (the `CHECK` constraint and the publication change don't appear in generated types).

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (nothing consumes the new types yet — that's Task 3).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations lib/supabase/database.types.ts
git commit -m "feat(db): add conversation creation RPC, read-tracking policy, and realtime for chat"
```

---

### Task 3: Chat service layer

**Files:**
- Create: `lib/services/chat.ts`

**Interfaces:**
- Produces: `Message`, `ConversationDetail`, `ConversationSummary` (interfaces); `getOrCreateConversationForJob(jobId)`, `getConversationDetail(jobId)`, `markConversationRead(conversationId)`, `getConversationsForCurrentUser()` — consumed by Task 4 (per-job chat page) and Task 5 (conversation list page).
- Consumes: `getCurrentUser` (Phase 1's `lib/auth/get-current-user.ts`), `getJobDetail` (Phase 4/7's `lib/services/jobs.ts`, already returns `employerId`/`assignedWorkerId`), `createClient` (Phase 1's `lib/supabase/server.ts`), `appError` (Phase 1's `lib/errors.ts`).

- [ ] **Step 1: Write the service layer**

Create `lib/services/chat.ts`:

```ts
import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getJobDetail } from '@/lib/services/jobs'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface Message {
  id: string
  senderId: string
  body: string
  createdAt: string
}

export interface ConversationDetail {
  id: string
  jobId: string
  jobTitle: string
  otherPartyId: string
  otherPartyName: string
  messages: Message[]
}

export interface ConversationSummary {
  id: string
  jobId: string
  jobTitle: string
  otherPartyName: string
  lastMessageAt: string | null
  hasUnread: boolean
}

interface MessageRow {
  id: string
  sender_id: string
  body: string
  created_at: string
}

function mapConversationError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Pekerjaan ini belum memiliki pekerja yang ditugaskan.')
  }
  return appError('INTERNAL_ERROR')
}

export async function getOrCreateConversationForJob(jobId: string): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_or_create_conversation', { p_job_id: jobId })

  if (error) {
    throw mapConversationError(error.message)
  }

  return { id: data as string }
}

export async function getConversationDetail(jobId: string): Promise<ConversationDetail | null> {
  const user = await getCurrentUser()
  if (!user) {
    return null
  }

  const job = await getJobDetail(jobId)
  if (!job) {
    return null
  }

  const isEmployer = job.employerId === user.id
  const isAssignedWorker = job.assignedWorkerId === user.id
  if (!isEmployer && !isAssignedWorker) {
    return null
  }

  const otherPartyId = isEmployer ? job.assignedWorkerId : job.employerId
  if (!otherPartyId) {
    return null
  }

  const { id: conversationId } = await getOrCreateConversationForJob(jobId)

  const supabase = await createClient()

  const { data: otherProfile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', otherPartyId)
    .maybeSingle()

  if (profileError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: messageRows, error: messagesError } = await supabase
    .from('messages')
    .select('id, sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (messagesError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    id: conversationId,
    jobId: job.id,
    jobTitle: job.title,
    otherPartyId,
    otherPartyName: otherProfile?.full_name ?? 'Tidak diketahui',
    messages: (messageRows ?? []).map((row: MessageRow) => ({
      id: row.id,
      senderId: row.sender_id,
      body: row.body,
      createdAt: row.created_at,
    })),
  }
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
}

interface ParticipantRow {
  conversation_id: string
  last_read_at: string | null
}

export async function getConversationsForCurrentUser(): Promise<ConversationSummary[]> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()

  const { data: participantRows, error: participantsError } = await supabase
    .from('conversation_participants')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id)

  if (participantsError) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = (participantRows ?? []) as ParticipantRow[]
  if (rows.length === 0) {
    return []
  }

  const conversationIds = rows.map((row) => row.conversation_id)
  const lastReadById = new Map(rows.map((row) => [row.conversation_id, row.last_read_at]))

  const { data: conversations, error: conversationsError } = await supabase
    .from('conversations')
    .select('id, job_id, last_message_at')
    .in('id', conversationIds)

  if (conversationsError) {
    throw appError('INTERNAL_ERROR')
  }

  const convRows = conversations ?? []
  if (convRows.length === 0) {
    return []
  }

  const jobIds = convRows.map((row) => row.job_id)
  const { data: jobs, error: jobsError } = await supabase
    .from('jobs')
    .select('id, title, employer_id, assigned_worker_id')
    .in('id', jobIds)

  if (jobsError) {
    throw appError('INTERNAL_ERROR')
  }

  const jobById = new Map((jobs ?? []).map((job) => [job.id, job]))

  function otherPartyIdFor(jobId: string): string | null {
    const job = jobById.get(jobId)
    if (!job) return null
    return job.employer_id === user.id ? job.assigned_worker_id : job.employer_id
  }

  const otherPartyIds = Array.from(
    new Set(convRows.map((row) => otherPartyIdFor(row.job_id)).filter((id): id is string => Boolean(id)))
  )

  const { data: profiles, error: profilesError } =
    otherPartyIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', otherPartyIds)
      : { data: [], error: null }

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  const summaries: ConversationSummary[] = convRows.map((row) => {
    const job = jobById.get(row.job_id)
    const otherPartyId = otherPartyIdFor(row.job_id)
    const lastReadAt = lastReadById.get(row.id) ?? null
    const hasUnread = Boolean(row.last_message_at && (!lastReadAt || row.last_message_at > lastReadAt))

    return {
      id: row.id,
      jobId: row.job_id,
      jobTitle: job?.title ?? 'Pekerjaan tidak diketahui',
      otherPartyName: otherPartyId ? (nameById.get(otherPartyId) ?? 'Tidak diketahui') : 'Tidak diketahui',
      lastMessageAt: row.last_message_at,
      hasUnread,
    }
  })

  summaries.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0
    if (!a.lastMessageAt) return 1
    if (!b.lastMessageAt) return -1
    return b.lastMessageAt.localeCompare(a.lastMessageAt)
  })

  return summaries
}
```

Note: every function uses `createClient()` (the auth-context server client) — this file never imports `createServiceClient` and never calls `.channel(...)` (realtime subscriptions and the message insert itself live in Task 4's client component, using the *browser* client instead, since this file is `server-only`).

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors. This also confirms Task 2's regenerated types (with `get_or_create_conversation` present) are being picked up correctly.

- [ ] **Step 3: Commit**

```bash
git add lib/services/chat.ts
git commit -m "feat(chat): add conversation and message service layer"
```

---

### Task 4: Per-job chat page (realtime thread)

**Files:**
- Create: `app/jobs/[id]/chat/page.tsx`
- Create: `app/jobs/[id]/chat/chat-thread.tsx`
- Modify: `app/jobs/[id]/page.tsx` (add one link — see Step 3)

**Interfaces:**
- Consumes: `getConversationDetail`, `markConversationRead` (Task 3); `getCurrentUser` (Phase 1); `MessageBodySchema` (Task 1); `createClient` from `lib/supabase/client.ts` (Phase 1, the **browser** client, unused until now).
- `chat-thread.tsx` defines its own local `ChatMessage` interface rather than importing `Message` from `lib/services/chat.ts` — this is intentional, not an oversight to fix: `lib/services/chat.ts` starts with `import 'server-only'`, so importing anything from it into a `'use client'` component would break the build. The two shapes are structurally identical (`{id, senderId, body, createdAt}`) by design, so `page.tsx` can pass a `Message[]` where `ChatMessage[]` is expected with no cast needed.

- [ ] **Step 1: Create the chat thread client component**

Create `app/jobs/[id]/chat/chat-thread.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { MessageBodySchema } from '@/lib/validations/chat'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ChatMessage {
  id: string
  senderId: string
  body: string
  createdAt: string
}

export function ChatThread({
  conversationId,
  currentUserId,
  otherPartyName,
  initialMessages,
}: {
  conversationId: string
  currentUserId: string
  otherPartyName: string
  initialMessages: ChatMessage[]
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string
            sender_id: string
            body: string
            created_at: string
          }
          setMessages((current) => {
            if (current.some((message) => message.id === row.id)) {
              return current
            }
            return [
              ...current,
              { id: row.id, senderId: row.sender_id, body: row.body, createdAt: row.created_at },
            ]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversationId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    setError(null)
    const validated = MessageBodySchema.safeParse({ body })
    if (!validated.success) {
      setError(validated.error.issues[0]?.message ?? 'Pesan tidak valid.')
      return
    }

    setIsSending(true)
    const supabase = createClient()

    const { error: insertError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      body: validated.data.body,
    })

    if (insertError) {
      setError('Gagal mengirim pesan.')
      setIsSending(false)
      return
    }

    await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', currentUserId)

    setBody('')
    setIsSending(false)
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded border p-3">
        {messages.length === 0 && (
          <li className="text-sm text-muted-foreground">Belum ada pesan. Mulai percakapan.</li>
        )}
        {messages.map((message) => (
          <li
            key={message.id}
            className={`flex max-w-[80%] flex-col gap-0.5 rounded p-2 text-sm ${
              message.senderId === currentUserId
                ? 'ml-auto bg-primary text-primary-foreground'
                : 'mr-auto bg-muted'
            }`}
          >
            <span className="text-xs opacity-70">
              {message.senderId === currentUserId ? 'Anda' : otherPartyName}
            </span>
            <span>{message.body}</span>
            <span className="text-xs opacity-70">
              {new Date(message.createdAt).toLocaleTimeString('id-ID')}
            </span>
          </li>
        ))}
        <div ref={bottomRef} />
      </ul>
      <div className="flex flex-col gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Tulis pesan..."
          rows={3}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" onClick={handleSend} disabled={isSending}>
          {isSending ? 'Mengirim...' : 'Kirim'}
        </Button>
      </div>
    </div>
  )
}
```

Note: no optimistic local echo of a sent message — the sender's own insert comes back through the same Realtime subscription every participant uses, so there's exactly one code path that adds a message to the list. The `current.some(...)` id-dedupe guard exists only in case a message is somehow already present (e.g. React StrictMode's double-invoke in development).

- [ ] **Step 2: Create the chat page**

Create `app/jobs/[id]/chat/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getConversationDetail, markConversationRead } from '@/lib/services/chat'
import { ChatThread } from './chat-thread'

export default async function JobChatPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const conversation = await getConversationDetail(id)
  if (!conversation) {
    notFound()
  }

  await markConversationRead(conversation.id)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">Chat: {conversation.jobTitle}</h1>
      <p className="text-sm text-muted-foreground">Percakapan dengan {conversation.otherPartyName}</p>
      <ChatThread
        conversationId={conversation.id}
        currentUserId={user.id}
        otherPartyName={conversation.otherPartyName}
        initialMessages={conversation.messages}
      />
    </div>
  )
}
```

Note: `getConversationDetail` returns `null` both for "not a participant" and "job doesn't exist" (matching the established `notFound()`-not-an-error-page convention) — it also returns `null` when the job has no assigned worker yet (since `otherPartyId` would be `null` in that branch), so visiting this route before assignment correctly 404s rather than lazily creating a conversation for an unassigned job.

- [ ] **Step 3: Link to the chat page from the job detail page**

Read `app/jobs/[id]/page.tsx` first to confirm its current exact content (it currently ends its status-conditional links with the "Lihat Progres Pekerjaan" block added in Phase 7). It currently has:

```tsx
      {(isOwner || job.assignedWorkerId === user?.id) &&
        ['payment_verified', 'in_progress', 'waiting_confirmation', 'completed'].includes(
          job.status
        ) && (
          <Link
            href={`/jobs/${job.id}/completion`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Lihat Progres Pekerjaan
          </Link>
        )}
```

Add this immediately after it:

```tsx
      {job.assignedWorkerId !== null && (isOwner || job.assignedWorkerId === user?.id) && (
        <Link href={`/jobs/${job.id}/chat`} className="text-sm text-primary underline-offset-4 hover:underline">
          Chat
        </Link>
      )}
```

Unlike the payment/completion links (gated to a specific list of statuses), this one is gated only on `assignedWorkerId` being set — chat is available for the rest of the job's life once assigned, per the design's "never closes" decision.

- [ ] **Step 4: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 5: Commit**

```bash
git add app/jobs
git commit -m "feat(chat): add per-job realtime chat page"
```

---

### Task 5: Conversation list page

**Files:**
- Create: `app/chat/page.tsx`

**Interfaces:**
- Consumes: `getConversationsForCurrentUser` (Task 3); `getCurrentUser` (Phase 1).

- [ ] **Step 1: Create the conversation list page**

Create `app/chat/page.tsx`:

```tsx
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getConversationsForCurrentUser } from '@/lib/services/chat'

export default async function ChatListPage() {
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const conversations = await getConversationsForCurrentUser()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Percakapan Saya</h1>
      {conversations.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada percakapan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <Link
              href={`/jobs/${conversation.jobId}/chat`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{conversation.jobTitle}</span>
                <span className="text-muted-foreground">{conversation.otherPartyName}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                {conversation.hasUnread && (
                  <span className="h-2 w-2 rounded-full bg-primary" aria-label="Belum dibaca" />
                )}
                {conversation.lastMessageAt && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(conversation.lastMessageAt).toLocaleString('id-ID')}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add app/chat
git commit -m "feat(chat): add conversation list page"
```

---

### Task 6: Phase 9 Definition-of-Done verification

**Files:** none (verification only).

**This task must be genuinely executed with a real running app and two real browser contexts (Playwright), not attested to from code review alone.** Playwright + Chromium should already be installed on this machine — do not reinstall; if `require('playwright')` doesn't resolve directly from this worktree's `node_modules`, set `NODE_PATH` to the npx cache directory (find it via `find ~/.npm/_npx -maxdepth 2 -name playwright -type d 2>/dev/null` if unsure).

- [ ] **Step 1: Run the full verification suite**

```bash
npm run typecheck
npx eslint .
npx vitest run
npm run build
```

Expected: all four succeed. Test count should be 67 (current total) + Task 1's 5 = 72.

- [ ] **Step 2: Create test accounts and an assigned job**

Create 1 employer + 1 worker account (`phase9-employer@example.com`, `phase9-worker@example.com`, password `password1`) via the same `auth.admin.createUser` + `user_roles` pattern used in every prior phase's verification. Get a job to `assigned` status with the worker as `assigned_worker_id` — either by driving the apply→select flow through the actual UI (recommended, since it also re-confirms Phases 4-5 still work end-to-end), or by directly inserting a `job_applications` row and calling `select_job_worker` via a one-off script if faster. The job does not need to go any further than `assigned` — chat is available from that point on, and this phase doesn't touch payment/completion.

- [ ] **Step 3: Verify the full flow with two real browser contexts**

Start the dev server, wait for it to actually respond (poll, don't sleep-guess). Open **two separate browser contexts** (not just two tabs sharing one session — each needs its own logged-in identity), one as the employer, one as the worker:

1. As the worker, visit `/jobs/[id]` for the assigned job — confirm a "Chat" link appears.
2. Click it, land on `/jobs/[id]/chat` — confirm the page loads with an empty message list ("Belum ada pesan. Mulai percakapan."). Check directly against the DB: a `conversations` row now exists for this job, and two `conversation_participants` rows exist (employer + worker). Reload the page once — confirm no duplicate conversation or participant rows are created (idempotent).
3. As the employer (second browser context), visit `/jobs/[id]/chat` — confirm it loads showing the same empty conversation (same conversation id as the worker saw).
4. As the worker, type a message and click "Kirim" — confirm it appears in the worker's own message list within a second or two, right-aligned, labeled "Anda".
5. **Without reloading**, check the employer's already-open browser context — confirm the same message appears automatically (realtime delivery), left-aligned, labeled with the worker's name.
6. As the employer, reply with a message — confirm it appears in the employer's own list, and then automatically in the worker's already-open tab without a reload.
7. Attempt to submit a blank message (or whitespace-only) — confirm the client-side validation error appears and no row is inserted (check the DB message count is unchanged).
8. Visit `/chat` as the worker — confirm the conversation appears with the job title, the employer's name, and the correct last-message timestamp. Since the worker's own last message (or the read-marking on page load) is the most recent thing they've seen, confirm **no unread indicator** shows here immediately after being in the thread.
9. As the employer, send one more message, then — **without the worker having opened the chat page again** — visit `/chat` as the worker: confirm the unread indicator **does** show now.
10. As the worker, open `/jobs/[id]/chat` (marking it read), then revisit `/chat` — confirm the unread indicator is gone.
11. As a different, uninvolved authenticated account (a plain worker with no connection to this job), attempt to visit `/jobs/[id]/chat` directly — confirm `notFound()` (404).
12. As a plain (non-admin, non-participant) authenticated account, visit `/chat` — confirm it loads successfully showing an empty list ("Belum ada percakapan."), not an error or someone else's data.

- [ ] **Step 4: Clean up the test accounts, job, and chat data**

Delete in FK-safe order: `messages` → `conversation_participants` → `conversations` → `job_applications`/`job_assignments` → `jobs` → `user_roles` → `profiles` → `auth.users`. Verify zero leftovers afterward. Stop the dev server cleanly (kill the exact PID on the port, not a broad `pkill`).

- [ ] **Step 5: Report results**

Note clearly which of Step 3's 12 checks passed, with what was actually observed (not just "pass") — mirroring every prior phase's verification report format. If any fail, do not mark Phase 9 complete — investigate per `superpowers:systematic-debugging` before declaring done.

## Phase 9 Definition of Done

- [ ] Visiting `/jobs/[id]/chat` as the job's employer or assigned worker lazily creates the conversation (idempotent — no duplicate rows on reload); anyone else gets `notFound()`.
- [ ] A message sent by one party appears in the other party's already-open tab without a manual refresh (genuine Realtime delivery, verified with two separate browser contexts).
- [ ] Sending a blank or whitespace-only message is rejected client-side with no row inserted.
- [ ] `/chat` lists every conversation the current user participates in, with the correct job title, other party's name, and last-message time.
- [ ] The unread indicator on `/chat` is accurate: it appears when the other party has sent something since the viewer's last read, and clears once the viewer opens that conversation. Sending a message also counts as reading up to that point, so a conversation the viewer just sent the last message in never shows as unread to themselves.
- [ ] `npm run typecheck`, `npx eslint .`, `npx vitest run`, and `npm run build` all pass.
- [ ] Step 3's full 12-check two-browser-context walkthrough was genuinely executed via Playwright, not attested to from code review.
