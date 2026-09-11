import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAdminDashboardStats } from '@/lib/services/admin-dashboard'

export default async function AdminDashboardPage() {
  await requireAdminOr404()
  const stats = await getAdminDashboardStats()

  const tiles: { label: string; value: number }[] = [
    { label: 'Total Pengguna', value: stats.totalUsers },
    { label: 'Total Worker', value: stats.totalWorkers },
    { label: 'Total Employer', value: stats.totalEmployers },
    { label: 'Pekerjaan Aktif', value: stats.activeJobs },
    { label: 'Pekerjaan Selesai', value: stats.completedJobs },
    { label: 'Pembayaran Menunggu Verifikasi', value: stats.pendingPayments },
    { label: 'Withdrawal Menunggu Proses', value: stats.pendingWithdrawals },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Dashboard Admin</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="flex flex-col gap-1 rounded border p-4">
            <span className="text-2xl font-semibold">{tile.value}</span>
            <span className="text-sm text-muted-foreground">{tile.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
