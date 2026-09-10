import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getWalletForCurrentUser } from '@/lib/services/wallet'
import { getWithdrawalsForCurrentUser } from '@/lib/services/withdrawals'
import { createClient } from '@/lib/supabase/server'
import { RequestWithdrawalForm } from './request-withdrawal-form'

export default async function WalletPage() {
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const wallet = await getWalletForCurrentUser()
  const withdrawals = await getWithdrawalsForCurrentUser()
  const hasActiveWithdrawal = withdrawals.some(
    (withdrawal) => withdrawal.status === 'pending' || withdrawal.status === 'processing'
  )

  const supabase = await createClient()
  const withdrawalsWithUrls = await Promise.all(
    withdrawals.map(async (withdrawal) => {
      if (!withdrawal.transferProofPath) {
        return { ...withdrawal, signedUrl: null as string | null }
      }
      const { data } = await supabase.storage
        .from('withdrawal-proofs')
        .createSignedUrl(withdrawal.transferProofPath, 60)
      return { ...withdrawal, signedUrl: data?.signedUrl ?? null }
    })
  )

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
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Ajukan Withdrawal</span>
        {hasActiveWithdrawal && (
          <p className="text-sm text-muted-foreground">
            Anda masih memiliki permintaan withdrawal yang sedang diproses.
          </p>
        )}
        {!hasActiveWithdrawal && <RequestWithdrawalForm balance={wallet.balance} />}
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Riwayat Withdrawal</span>
        {withdrawalsWithUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada permintaan withdrawal.</p>
        )}
        <ul className="flex flex-col gap-2">
          {withdrawalsWithUrls.map((withdrawal) => (
            <li key={withdrawal.id} className="flex flex-col gap-1 rounded border p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">Rp{withdrawal.amount.toLocaleString('id-ID')}</span>
                <span className="text-muted-foreground">{withdrawal.status}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {withdrawal.bankName} - {withdrawal.accountNumber} a.n. {withdrawal.accountHolderName}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(withdrawal.createdAt).toLocaleString('id-ID')}
              </span>
              {withdrawal.status === 'rejected' && withdrawal.rejectionReason && (
                <p className="text-sm text-destructive">Alasan penolakan: {withdrawal.rejectionReason}</p>
              )}
              {withdrawal.status === 'paid' && withdrawal.signedUrl && (
                <a
                  href={withdrawal.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Lihat Bukti Transfer
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
