import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getWithdrawalsForAdmin } from '@/lib/services/withdrawals'

export default async function AdminWithdrawalsPage() {
  await requireAdminOr404()
  const withdrawals = await getWithdrawalsForAdmin()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Withdrawal</h1>
      {withdrawals.length === 0 && <p className="text-sm text-muted-foreground">Belum ada withdrawal.</p>}
      <ul className="flex flex-col gap-2">
        {withdrawals.map((withdrawal) => (
          <li key={withdrawal.id}>
            <Link
              href={`/admin/withdrawals/${withdrawal.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span className="font-medium">{withdrawal.userName}</span>
              <div className="flex flex-col items-end gap-1">
                <span>Rp{withdrawal.amount.toLocaleString('id-ID')}</span>
                <span className="text-muted-foreground">{withdrawal.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
