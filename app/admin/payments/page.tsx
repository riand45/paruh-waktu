import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getPendingPayments } from '@/lib/services/payments'

export default async function AdminPaymentsPage() {
  await requireAdminOr404()
  const payments = await getPendingPayments()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pembayaran</h1>
      {payments.length === 0 && <p className="text-sm text-muted-foreground">Belum ada pembayaran.</p>}
      <ul className="flex flex-col gap-2">
        {payments.map((payment) => (
          <li key={payment.id}>
            <Link
              href={`/admin/payments/${payment.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col gap-1">
                <span className="font-medium">{payment.jobTitle}</span>
                <span className="text-muted-foreground">{payment.employerName}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span>Rp{payment.totalAmount.toLocaleString('id-ID')}</span>
                <span className="text-muted-foreground">{payment.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
