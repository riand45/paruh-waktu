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
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId })

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
  const userId = user.id

  function otherPartyIdFor(jobId: string): string | null {
    const job = jobById.get(jobId)
    if (!job) return null
    return job.employer_id === userId ? job.assigned_worker_id : job.employer_id
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
