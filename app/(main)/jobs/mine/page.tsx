import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getOwnJobs } from '@/lib/services/jobs'

export default async function MyJobsPage() {
  const user = await getCurrentUser()

  if (!user || !user.roles.includes('employer')) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Anda harus terverifikasi sebagai Pemberi Kerja terlebih dahulu.
        </p>
        <Link
          href="/verification"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Ajukan Verifikasi
        </Link>
      </div>
    )
  }

  const jobs = await getOwnJobs()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pekerjaan Saya</h1>
      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">Anda belum membuat pekerjaan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center justify-between rounded border p-3 text-sm">
            <Link
              href={job.status === 'open' ? `/jobs/${job.id}/edit` : `/jobs/${job.id}`}
              className="flex flex-col gap-1 hover:underline"
            >
              <span className="font-medium">{job.title}</span>
              <span className="text-muted-foreground">{job.status}</span>
            </Link>
            <Link
              href={`/jobs/${job.id}/applicants`}
              className="text-primary underline-offset-4 hover:underline"
            >
              Pelamar
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
