import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { ReviewForm } from './review-form'

export default async function EmployerVerificationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin')

  const { id } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('employer_verifications')
    .select('id, status, full_name_on_ktp, ktp_number, ktp_document_path, rejection_reason, submitted_at')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    notFound()
  }

  const { data: signedUrlData } = await supabase.storage
    .from('kyc-documents')
    .createSignedUrl(data.ktp_document_path, 60)

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{data.full_name_on_ktp}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Nomor KTP</dt>
          <dd>{data.ktp_number}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{data.status}</dd>
        </div>
        {data.rejection_reason && (
          <div>
            <dt className="text-muted-foreground">Alasan Penolakan Sebelumnya</dt>
            <dd>{data.rejection_reason}</dd>
          </div>
        )}
      </dl>
      {signedUrlData?.signedUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
        <img src={signedUrlData.signedUrl} alt="Dokumen KTP" className="w-full rounded border" />
      )}
      {data.status === 'pending' && <ReviewForm verificationId={data.id} />}
    </div>
  )
}
