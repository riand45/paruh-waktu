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
