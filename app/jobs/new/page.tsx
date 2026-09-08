import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createJobAction } from '../actions'
import { JobForm } from '../job-form'

export default async function NewJobPage() {
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

  const supabase = await createClient()
  const { data: categories } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Buat Pekerjaan</h1>
      <JobForm action={createJobAction} categories={categories ?? []} submitLabel="Publikasikan" />
    </div>
  )
}
