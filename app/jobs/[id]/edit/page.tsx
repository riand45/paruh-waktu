import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { updateJobAction } from '../../actions'
import { JobForm } from '../../job-form'

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const supabase = await createClient()
  const { data: job } = await supabase
    .from('jobs')
    .select(
      'id, title, category_id, description, address, latitude, longitude, payment_amount, duration_minutes, deadline, status, employer_id'
    )
    .eq('id', id)
    .maybeSingle()

  if (!job || job.employer_id !== user.id || job.status !== 'open') {
    notFound()
  }

  const { data: categories } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  const boundUpdateAction = updateJobAction.bind(null, job.id)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Edit Pekerjaan</h1>
      <JobForm
        action={boundUpdateAction}
        categories={categories ?? []}
        submitLabel="Simpan Perubahan"
        defaultValues={{
          title: job.title,
          categoryId: job.category_id,
          description: job.description,
          address: job.address,
          latitude: String(job.latitude),
          longitude: String(job.longitude),
          paymentAmount: String(job.payment_amount),
          durationMinutes: String(job.duration_minutes),
          deadline: new Date(job.deadline).toISOString().slice(0, 16),
        }}
      />
    </div>
  )
}
