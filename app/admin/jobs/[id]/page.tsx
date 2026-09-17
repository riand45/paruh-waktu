import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getJobDetailForAdmin } from '@/lib/services/admin-jobs'
import { cancelJobAction, cancelJobAndRefundAction } from '../actions'
import { CancelJobForm } from './cancel-job-form'

export default async function AdminJobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const job = await getJobDetailForAdmin(id)
  if (!job) {
    notFound()
  }

  const isCancellable = job.status !== 'cancelled' && job.status !== 'completed'
  const needsRefundPath = job.paymentStatus === 'verified'
  const needsPaymentReviewFirst = job.paymentStatus === 'waiting_verification'

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{job.title}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Kategori</dt>
          <dd>{job.categoryName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Employer</dt>
          <dd>{job.employerName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Worker</dt>
          <dd>{job.assignedWorkerName ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
        {job.paymentStatus && (
          <div>
            <dt className="text-muted-foreground">Status Pembayaran</dt>
            <dd>{job.paymentStatus}</dd>
          </div>
        )}
        {job.cancelledReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Pembatalan</dt>
            <dd>{job.cancelledReason}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted-foreground">Nominal Pembayaran</dt>
          <dd>Rp{job.paymentAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Alamat</dt>
          <dd>{job.address}</dd>
        </div>
      </dl>
      <Link href={`/jobs/${job.id}`} className="text-sm text-primary underline-offset-4 hover:underline">
        Lihat Halaman Publik
      </Link>
      {isCancellable && needsPaymentReviewFirst && (
        <p className="rounded-md border border-yellow-600/30 bg-yellow-600/10 p-3 text-sm">
          Pekerjaan ini memiliki pembayaran yang sedang direview dan belum bisa dibatalkan.{' '}
          {job.paymentId ? (
            <Link href={`/admin/payments/${job.paymentId}`} className="underline underline-offset-4">
              Selesaikan review pembayaran
            </Link>
          ) : (
            'Selesaikan review pembayaran'
          )}{' '}
          terlebih dahulu.
        </p>
      )}
      {isCancellable && needsRefundPath && (
        <CancelJobForm jobId={job.id} action={cancelJobAndRefundAction} label="Batalkan & Mulai Refund" />
      )}
      {isCancellable && !needsRefundPath && !needsPaymentReviewFirst && (
        <CancelJobForm jobId={job.id} action={cancelJobAction} label="Batalkan Pekerjaan" />
      )}
    </div>
  )
}
