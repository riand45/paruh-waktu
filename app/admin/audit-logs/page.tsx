import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAuditLogsForAdmin } from '@/lib/services/audit-logs'

export default async function AdminAuditLogsPage() {
  await requireAdminOr404()
  const logs = await getAuditLogsForAdmin()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Log Aktivitas</h1>
      {logs.length === 0 && <p className="text-sm text-muted-foreground">Belum ada aktivitas tercatat.</p>}
      <ul className="flex flex-col gap-2">
        {logs.map((log) => (
          <li key={log.id} className="flex flex-col gap-1 rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{log.action}</span>
              <span className="text-xs text-muted-foreground">
                {new Date(log.createdAt).toLocaleString('id-ID')}
              </span>
            </div>
            <span className="text-muted-foreground">
              {log.actorName} &middot; {log.entityType}
              {log.entityId ? ` (${log.entityId})` : ''}
            </span>
            {log.description && <span>{log.description}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
