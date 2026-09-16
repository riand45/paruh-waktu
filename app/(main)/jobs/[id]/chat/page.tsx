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

  try {
    await markConversationRead(conversation.id)
  } catch (error) {
    // Same reasoning as chat-thread.tsx's post-send read-marking step: this only
    // affects whether the conversation shows as "unread" on the /chat list page,
    // and the messages below have already loaded successfully. This app has no
    // error.tsx, so letting this throw would take the whole page down to a 500
    // over a purely cosmetic failure. Log it for visibility and keep rendering.
    console.error('Failed to mark conversation as read:', error)
  }

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
