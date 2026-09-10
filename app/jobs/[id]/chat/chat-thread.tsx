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
    let cancelled = false
    const supabase = createClient()
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function subscribeToMessages() {
      // `createBrowserClient` resolves its session from cookies asynchronously, and only
      // then does supabase-js propagate the access token to the Realtime client (via
      // `onAuthStateChange`'s INITIAL_SESSION event calling `realtime.setAuth`). Subscribing
      // before that finishes sends the channel's `phx_join` without an access token, so the
      // server authorizes the channel at anon level and silently never forwards this
      // RLS-gated table's postgres_changes events. Resolving the session and setting the
      // Realtime auth explicitly, before subscribing, closes that race.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return

      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token)
        if (cancelled) return
      }

      channel = supabase
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
    }

    subscribeToMessages()

    return () => {
      cancelled = true
      if (channel) {
        supabase.removeChannel(channel)
      }
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

    try {
      const { error: insertError } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: currentUserId,
        body: validated.data.body,
      })

      if (insertError) {
        setError('Gagal mengirim pesan.')
        return
      }

      const { error: readError } = await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', currentUserId)

      if (readError) {
        // The message itself was already sent successfully (visible via realtime to
        // both parties) — this update is a secondary, non-fatal step that only affects
        // whether this conversation shows as "unread" to the sender on the /chat list
        // page. Log it for visibility, but don't surface a user-facing error for a
        // message that did, in fact, send.
        console.error('Failed to update last_read_at after sending message:', readError)
      }

      setBody('')
    } finally {
      setIsSending(false)
    }
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
