import { Suspense } from 'react'
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getJobsForAdmin } from '@/lib/services/admin-jobs'
import { getActiveJobCategories } from '@/lib/services/job-categories'
import { JobFilters } from './job-filters'

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; categoryId?: string }>
}) {
  await requireAdminOr404()
  const { search, status, categoryId } = await searchParams

  const [jobs, { categories }] = await Promise.all([
    getJobsForAdmin({ search, status, categoryId }),
    getActiveJobCategories(),
  ])

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pekerjaan</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <JobFilters categories={categories} />
      </Suspense>
      {jobs.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada pekerjaan ditemukan.</p>}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={`/admin/jobs/${job.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col">
                <span className="font-medium">{job.title}</span>
                <span className="text-muted-foreground">{job.employerName}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span>{job.assignedWorkerName ?? '-'}</span>
                <span className="text-muted-foreground">{job.status}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
