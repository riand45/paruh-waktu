import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getWalletForCurrentUser } from '@/lib/services/wallet'

export default async function WalletPage() {
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const wallet = await getWalletForCurrentUser()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Wallet Saya</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Saldo</dt>
          <dd className="text-lg font-semibold">Rp{wallet.balance.toLocaleString('id-ID')}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Riwayat Transaksi</span>
        {wallet.transactions.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada transaksi.</p>
        )}
        <ul className="flex flex-col gap-2">
          {wallet.transactions.map((transaction) => (
            <li
              key={transaction.id}
              className="flex items-center justify-between rounded border p-3 text-sm"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{transaction.type}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(transaction.createdAt).toLocaleString('id-ID')}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className={transaction.amount < 0 ? 'text-destructive' : 'text-green-600'}>
                  {transaction.amount < 0 ? '-' : '+'}Rp
                  {Math.abs(transaction.amount).toLocaleString('id-ID')}
                </span>
                <span className="text-muted-foreground">
                  Saldo: Rp{transaction.balanceAfter.toLocaleString('id-ID')}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
