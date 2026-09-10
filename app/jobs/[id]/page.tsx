import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getJobDetail } from '@/lib/services/jobs'
import { getMyApplicationForJob } from '@/lib/services/applications'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { ApplyForm } from '@/app/applications/apply-form'
import { cancelApplicationAction } from '@/app/applications/actions'
import { Button } from '@/components/ui/button'

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const job = await getJobDetail(id)

  if (!job) {
    notFound()
  }

  const user = await getCurrentUser()
  const isOwner = user?.id === job.employerId
  const mapsUrl = `https://www.google.com/maps?q=${job.latitude},${job.longitude}`

  const myApplication = !isOwner ? await getMyApplicationForJob(job.id) : null
  const canApply =
    !isOwner &&
    job.status === 'open' &&
    (!myApplication || ['rejected', 'cancelled'].includes(myApplication.status))

  const boundCancelAction = myApplication
    ? cancelApplicationAction.bind(null, myApplication.id, job.id)
    : null

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">{job.title}</h1>
      <p className="text-sm text-muted-foreground">{job.description}</p>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Alamat</dt>
          <dd>{job.address}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nominal Pembayaran</dt>
          <dd>Rp{job.paymentAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Durasi</dt>
          <dd>{job.durationMinutes} menit</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Deadline</dt>
          <dd>{new Date(job.deadline).toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
      </dl>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Lihat Lokasi di Google Maps
      </a>
      {isOwner && job.status === 'open' && (
        <Link
          href={`/jobs/${job.id}/edit`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Edit Pekerjaan
        </Link>
      )}
      {isOwner && (
        <Link
          href={`/jobs/${job.id}/applicants`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Lihat Pelamar
        </Link>
      )}
      {isOwner &&
        [
          'assigned',
          'waiting_payment',
          'payment_review',
          'payment_verified',
          'payment_rejected',
          'in_progress',
          'waiting_confirmation',
          'completed',
        ].includes(job.status) && (
          <Link
            href={`/jobs/${job.id}/payment`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Lihat Pembayaran
          </Link>
        )}
      {(isOwner || job.assignedWorkerId === user?.id) &&
        ['payment_verified', 'in_progress', 'waiting_confirmation', 'completed'].includes(
          job.status
        ) && (
          <Link
            href={`/jobs/${job.id}/completion`}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Lihat Progres Pekerjaan
          </Link>
        )}
      {!isOwner && myApplication && !canApply && (
        <div className="flex flex-col gap-2 rounded border p-3 text-sm">
          <span className="text-muted-foreground">Status Lamaran Anda</span>
          <span className="font-medium">{myApplication.status}</span>
          {myApplication.status === 'pending' && boundCancelAction && (
            <form action={boundCancelAction}>
              <Button type="submit" variant="outline" size="sm">
                Batalkan Lamaran
              </Button>
            </form>
          )}
        </div>
      )}
      {canApply && <ApplyForm jobId={job.id} />}
    </div>
  )
}
