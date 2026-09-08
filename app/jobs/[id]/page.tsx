import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getJobDetail } from '@/lib/services/jobs'
import { getCurrentUser } from '@/lib/auth/get-current-user'

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
    </div>
  )
}
