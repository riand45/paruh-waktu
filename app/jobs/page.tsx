import { Suspense } from 'react'
import Link from 'next/link'
import { getJobListing } from '@/lib/services/jobs'
import { createClient } from '@/lib/supabase/server'
import { JobFilters } from './job-filters'

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const { data: categories } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  const jobs = await getJobListing({
    keyword: params.keyword || undefined,
    categoryId: params.category || undefined,
    minPayment: params.minPayment ? Number(params.minPayment) : undefined,
    maxPayment: params.maxPayment ? Number(params.maxPayment) : undefined,
    workerLat: params.lat ? Number(params.lat) : undefined,
    workerLng: params.lng ? Number(params.lng) : undefined,
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Cari Pekerjaan</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <JobFilters categories={categories ?? []} />
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
