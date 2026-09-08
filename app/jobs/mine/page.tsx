import Link from 'next/link'
import { getOwnJobs } from '@/lib/services/jobs'

export default async function MyJobsPage() {
  const jobs = await getOwnJobs()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pekerjaan Saya</h1>
      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">Anda belum membuat pekerjaan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={job.status === 'open' ? `/jobs/${job.id}/edit` : `/jobs/${job.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span>{job.title}</span>
              <span className="text-muted-foreground">{job.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
