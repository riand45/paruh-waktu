import { Suspense } from 'react'
import Link from 'next/link'
import { getJobListing } from '@/lib/services/jobs'
import { getActiveJobCategories } from '@/lib/services/job-categories'
import { JobFilters } from './job-filters'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function finiteOrUndefined(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function validCategoryOrUndefined(value: string | undefined): string | undefined {
  if (!value || !UUID_REGEX.test(value)) return undefined
  return value
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const { categories, error: categoriesError } = await getActiveJobCategories()

  const jobs = await getJobListing({
    keyword: params.keyword || undefined,
    categoryId: validCategoryOrUndefined(params.category),
    minPayment: finiteOrUndefined(params.minPayment),
    maxPayment: finiteOrUndefined(params.maxPayment),
    workerLat: finiteOrUndefined(params.lat),
    workerLng: finiteOrUndefined(params.lng),
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Cari Pekerjaan</h1>
      {categoriesError && (
        <p className="text-sm text-destructive">
          Gagal memuat data. Silakan muat ulang halaman.
        </p>
      )}
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <JobFilters categories={categories} />
      </Suspense>
      {jobs.length === 0 && (
        <p className="text-sm text-muted-foreground">Tidak ada pekerjaan ditemukan.</p>
      )}
      <ul className="flex flex-col gap-2">
        {jobs.map((job) => (
          <li key={job.id}>
            <Link
              href={`/jobs/${job.id}`}
              className="flex flex-col gap-1 rounded border p-3 text-sm hover:bg-muted"
            >
              <span className="font-medium">{job.title}</span>
              <span className="text-muted-foreground">{job.address}</span>
              <span>Rp{job.paymentAmount.toLocaleString('id-ID')}</span>
              {job.distanceKm !== null && (
                <span className="text-muted-foreground">{job.distanceKm.toFixed(1)} km</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
