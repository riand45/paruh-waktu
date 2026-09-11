import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface AuditLogEntry {
  id: string
  actorName: string
  action: string
  entityType: string
  entityId: string | null
  description: string | null
  createdAt: string
}

export async function getAuditLogsForAdmin(): Promise<AuditLogEntry[]> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('id, actor_id, action, entity_type, entity_id, description, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = logs ?? []
  if (rows.length === 0) {
    return []
  }

  const actorIds = [...new Set(rows.filter((row) => row.actor_id).map((row) => row.actor_id as string))]
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', actorIds)

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  return rows.map((row) => ({
    id: row.id,
    actorName: row.actor_id ? (nameById.get(row.actor_id) ?? 'Tidak diketahui') : 'Sistem',
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    description: row.description,
    createdAt: row.created_at,
  }))
}
