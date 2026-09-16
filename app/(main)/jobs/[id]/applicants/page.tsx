import { notFound } from 'next/navigation'
import { getJobDetail } from '@/lib/services/jobs'
import { getApplicationsForJob } from '@/lib/services/applications'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { ApplicantRow } from './applicant-row'

export default async function JobApplicantsPage({
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

  const applicants = await getApplicationsForJob(id)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pelamar: {job.title}</h1>
      {applicants.length === 0 && (
        <p className="text-sm text-muted-foreground">Belum ada yang melamar pekerjaan ini.</p>
      )}
      <ul className="flex flex-col gap-2">
        {applicants.map((applicant) => (
          <ApplicantRow
            key={applicant.id}
            jobId={id}
            applicationId={applicant.id}
            workerName={applicant.workerName}
            message={applicant.message}
            status={applicant.status}
            appliedAt={applicant.appliedAt}
            canManage={job.status === 'open'}
          />
        ))}
      </ul>
    </div>
  )
}
