import { notFound } from 'next/navigation'
import { getJobDetail } from '@/lib/services/jobs'
import { getPaymentForJob } from '@/lib/services/payments'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { PaymentProofForm } from './payment-proof-form'

interface AdminBankAccount {
  bank_name: string
  account_number: string
  account_holder_name: string
}

export default async function JobPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const job = await getJobDetail(id)
  if (!job || job.employerId !== user.id) {
    notFound()
  }

  const payment = await getPaymentForJob(id)
  if (!payment) {
    notFound()
  }

  const supabase = await createClient()
  const { data: bankSetting } = await supabase
    .from('platform_settings')
    .select('value')
    .eq('key', 'admin_bank_account')
    .maybeSingle()

  const bankAccount = bankSetting?.value as AdminBankAccount | undefined

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pembayaran: {job.title}</h1>
      {bankAccount && (
        <dl className="flex flex-col gap-2 rounded border p-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Bank</dt>
            <dd>{bankAccount.bank_name}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Nomor Rekening</dt>
            <dd>{bankAccount.account_number}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Atas Nama</dt>
            <dd>{bankAccount.account_holder_name}</dd>
          </div>
        </dl>
      )}
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Total yang Harus Ditransfer</dt>
          <dd className="text-lg font-semibold">Rp{payment.totalAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status Pembayaran</dt>
          <dd>{payment.status}</dd>
        </div>
      </dl>
      {payment.status === 'rejected' && payment.rejectionReason && (
        <p className="text-sm text-destructive">Alasan penolakan: {payment.rejectionReason}</p>
      )}
      {(payment.status === 'waiting_payment' || payment.status === 'rejected') && (
        <PaymentProofForm paymentId={payment.id} jobId={id} />
      )}
      {payment.status === 'waiting_verification' && (
        <p className="text-sm text-muted-foreground">Menunggu verifikasi Admin.</p>
      )}
      {payment.status === 'verified' && (
        <p className="text-sm text-green-600">Pembayaran telah diverifikasi.</p>
      )}
    </div>
  )
}
