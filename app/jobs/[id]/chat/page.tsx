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
