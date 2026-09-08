import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'

export default async function EmployerVerificationsListPage() {
  await requireAdminOr404()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employer_verifications')
    .select('id, status, full_name_on_ktp, submitted_at')
    .order('submitted_at', { ascending: false })

  const verifications = data ?? []

  const statusOrder: Record<string, number> = { pending: 0, approved: 1, rejected: 2 }
  verifications.sort(
    (a, b) =>
      statusOrder[a.status] - statusOrder[b.status] ||
      new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime()
  )

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pemberi Kerja</h1>
      {error && (
        <p className="text-sm text-destructive">
          Gagal memuat data. Silakan muat ulang halaman.
        </p>
      )}
      {!error && verifications.length === 0 && (
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
              <span className="flex items-center gap-3 text-muted-foreground">
                <span>{new Date(v.submitted_at).toLocaleDateString('id-ID')}</span>
                <span>{v.status}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
