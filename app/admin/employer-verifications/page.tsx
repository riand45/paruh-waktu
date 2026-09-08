import Link from 'next/link'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'

export default async function EmployerVerificationsListPage() {
  await requireRole('admin')

  const supabase = await createClient()
  const { data } = await supabase
    .from('employer_verifications')
    .select('id, status, full_name_on_ktp, submitted_at')
    .order('submitted_at', { ascending: false })

  const verifications = data ?? []

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pemberi Kerja</h1>
      {verifications.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada pengajuan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {verifications.map((v) => (
          <li key={v.id}>
            <Link
              href={`/admin/employer-verifications/${v.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span>{v.full_name_on_ktp}</span>
              <span className="text-muted-foreground">{v.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
