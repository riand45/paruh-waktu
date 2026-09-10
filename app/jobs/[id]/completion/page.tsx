import { notFound } from 'next/navigation'
import { getJobDetail } from '@/lib/services/jobs'
import { getJobEvidences, startWork } from '@/lib/services/completions'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { EvidenceUploadForm } from './evidence-upload-form'
import { SubmitCompletionButton } from './submit-completion-button'
import { ConfirmCompletionButton } from './confirm-completion-button'

const READY_STATUSES = ['payment_verified', 'in_progress', 'waiting_confirmation', 'completed']

export default async function JobCompletionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await getCurrentUser()
  if (!user) {
    notFound()
  }

  const initialJob = await getJobDetail(id)
  if (!initialJob) {
    notFound()
  }

  const isEmployer = initialJob.employerId === user.id
  const isAssignedWorker = initialJob.assignedWorkerId === user.id

  if (!isEmployer && !isAssignedWorker) {
    notFound()
  }

  if (!READY_STATUSES.includes(initialJob.status)) {
    notFound()
  }

  if (isAssignedWorker && initialJob.status === 'payment_verified') {
    await startWork(id)
  }

  const job =
    isAssignedWorker && initialJob.status === 'payment_verified'
      ? ((await getJobDetail(id)) ?? initialJob)
      : initialJob

  const evidences = await getJobEvidences(id)
  const supabase = await createClient()
  const evidencesWithUrls = await Promise.all(
    evidences.map(async (evidence) => {
      const { data } = await supabase.storage
        .from('job-evidences')
        .createSignedUrl(evidence.filePath, 60)
      return { ...evidence, signedUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Penyelesaian: {job.title}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{job.status}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Bukti Pekerjaan</span>
        {evidencesWithUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada bukti pekerjaan.</p>
        )}
        {evidencesWithUrls.map((evidence) => (
          <div key={evidence.id} className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Diunggah {new Date(evidence.uploadedAt).toLocaleString('id-ID')}
            </span>
            {!evidence.signedUrl && (
              <p className="text-sm text-destructive">Gagal memuat bukti pekerjaan.</p>
            )}
            {evidence.signedUrl && evidence.fileType.startsWith('image/') && (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
              <img src={evidence.signedUrl} alt="Bukti pekerjaan" className="max-w-full rounded border" />
            )}
            {evidence.signedUrl && evidence.fileType.startsWith('video/') && (
              <video src={evidence.signedUrl} controls className="max-w-full rounded border" />
            )}
          </div>
        ))}
      </div>
      {isAssignedWorker && job.status === 'in_progress' && (
        <>
          <EvidenceUploadForm jobId={id} />
          <SubmitCompletionButton jobId={id} />
        </>
      )}
      {isEmployer && job.status === 'waiting_confirmation' && <ConfirmCompletionButton jobId={id} />}
      {job.status === 'completed' && (
        <p className="text-sm text-green-600">Pekerjaan telah dikonfirmasi selesai.</p>
      )}
    </div>
  )
}
