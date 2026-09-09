import Link from 'next/link'
import { getMyApplications } from '@/lib/services/applications'

export default async function MyApplicationsPage() {
  const applications = await getMyApplications()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Lamaran Saya</h1>
      {applications.length === 0 && (
        <p className="text-sm text-muted-foreground">Anda belum melamar pekerjaan apa pun.</p>
      )}
      <ul className="flex flex-col gap-2">
        {applications.map((application) => (
          <li key={application.id}>
            <Link
              href={`/jobs/${application.jobId}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <span className="flex flex-col">
                <span>{application.jobTitle}</span>
                <span className="text-xs text-muted-foreground">
                  Melamar pada {new Date(application.appliedAt).toLocaleString('id-ID')}
                </span>
              </span>
              <span className="text-muted-foreground">{application.status}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
