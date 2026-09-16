import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAdminDashboardStats } from '@/lib/services/admin-dashboard'

export default async function AdminDashboardPage() {
  await requireAdminOr404()
  const stats = await getAdminDashboardStats()

  const tiles: { label: string; value: number; href: string }[] = [
    { label: 'Total Pengguna', value: stats.totalUsers, href: '/admin/users' },
    { label: 'Total Worker', value: stats.totalWorkers, href: '/admin/users?role=worker' },
    { label: 'Total Employer', value: stats.totalEmployers, href: '/admin/users?role=employer' },
    { label: 'Pekerjaan Aktif', value: stats.activeJobs, href: '/admin/jobs' },
    { label: 'Pekerjaan Selesai', value: stats.completedJobs, href: '/admin/jobs?status=completed' },
    { label: 'Pembayaran Menunggu Verifikasi', value: stats.pendingPayments, href: '/admin/payments' },
    { label: 'Withdrawal Menunggu Proses', value: stats.pendingWithdrawals, href: '/admin/withdrawals' },
  ]

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Dashboard Admin</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Link
            key={tile.label}
            href={tile.href}
            className="flex flex-col gap-1 rounded border p-4 hover:bg-muted"
          >
            <span className="text-2xl font-semibold">{tile.value}</span>
            <span className="text-sm text-muted-foreground">{tile.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
