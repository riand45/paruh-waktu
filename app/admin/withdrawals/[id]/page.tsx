import { notFound } from 'next/navigation'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getWithdrawalDetailForAdmin } from '@/lib/services/withdrawals'
import { createClient } from '@/lib/supabase/server'
import { ProcessRejectForm } from './process-reject-form'
import { MarkPaidForm } from './mark-paid-form'

export default async function AdminWithdrawalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const withdrawal = await getWithdrawalDetailForAdmin(id)
  if (!withdrawal) {
    notFound()
  }

  let signedUrl: string | null = null
  if (withdrawal.transferProofPath) {
    const supabase = await createClient()
    const { data } = await supabase.storage
      .from('withdrawal-proofs')
      .createSignedUrl(withdrawal.transferProofPath, 60)
    signedUrl = data?.signedUrl ?? null
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Withdrawal: {withdrawal.userName}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Jumlah</dt>
          <dd className="text-lg font-semibold">Rp{withdrawal.amount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bank</dt>
          <dd>{withdrawal.bankName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nomor Rekening</dt>
          <dd>{withdrawal.accountNumber}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Atas Nama</dt>
          <dd>{withdrawal.accountHolderName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{withdrawal.status}</dd>
        </div>
        {withdrawal.rejectionReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Penolakan</dt>
            <dd>{withdrawal.rejectionReason}</dd>
          </div>
        )}
      </dl>
      {signedUrl && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Bukti Transfer</span>
          {/\.(jpg|jpeg|png)$/i.test(withdrawal.transferProofPath ?? '') ? (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
            <img src={signedUrl} alt="Bukti transfer" className="max-w-full rounded border" />
          ) : (
            <a
              href={signedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Lihat Bukti Transfer (PDF)
            </a>
          )}
        </div>
      )}
      {withdrawal.status === 'pending' && <ProcessRejectForm withdrawalId={withdrawal.id} />}
      {withdrawal.status === 'processing' && <MarkPaidForm withdrawalId={withdrawal.id} />}
    </div>
  )
}
