import { notFound } from 'next/navigation'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getPaymentDetailForAdmin } from '@/lib/services/payments'
import { createClient } from '@/lib/supabase/server'
import { ReviewForm } from './review-form'
import { CancelRefundForm } from './cancel-refund-form'
import { RefundProofForm } from './refund-proof-form'

export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const payment = await getPaymentDetailForAdmin(id)
  if (!payment) {
    notFound()
  }

  const supabase = await createClient()
  const proofsWithUrls = await Promise.all(
    payment.proofs.map(async (proof) => {
      const { data } = await supabase.storage.from('payment-proofs').createSignedUrl(proof.filePath, 60)
      return { ...proof, signedUrl: data?.signedUrl ?? null }
    })
  )

  const refundProofSignedUrl = payment.refundTransferProofPath
    ? (
        await supabase.storage.from('refund-proofs').createSignedUrl(payment.refundTransferProofPath, 60)
      ).data?.signedUrl ?? null
    : null
  const isRefundProofImage = payment.refundTransferProofPath
    ? /\.(jpg|jpeg|png)$/i.test(payment.refundTransferProofPath)
    : false

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pembayaran: {payment.jobTitle}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Employer</dt>
          <dd>{payment.employerName}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Nominal Pekerjaan</dt>
          <dd>Rp{payment.amount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Platform Fee</dt>
          <dd>Rp{payment.platformFee.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Total Transfer</dt>
          <dd>Rp{payment.totalAmount.toLocaleString('id-ID')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Tanggal Transfer</dt>
          <dd>{payment.transferDate ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status</dt>
          <dd>{payment.status}</dd>
        </div>
        {payment.rejectionReason && (
          <div>
            <dt className="text-muted-foreground">Alasan Penolakan Sebelumnya</dt>
            <dd>{payment.rejectionReason}</dd>
          </div>
        )}
      </dl>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Bukti Transfer</span>
        {proofsWithUrls.length === 0 && (
          <p className="text-sm text-muted-foreground">Belum ada bukti transfer.</p>
        )}
        {proofsWithUrls.map((proof) => {
          const isImage = /\.(jpg|jpeg|png)$/i.test(proof.filePath)
          return (
            <div key={proof.id} className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Diunggah {new Date(proof.uploadedAt).toLocaleString('id-ID')}
              </span>
              {!proof.signedUrl && <p className="text-sm text-destructive">Gagal memuat bukti transfer.</p>}
              {proof.signedUrl && isImage && (
                // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
                <img src={proof.signedUrl} alt="Bukti transfer" className="max-w-full rounded border" />
              )}
              {proof.signedUrl && !isImage && (
                <a
                  href={proof.signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Lihat Bukti Transfer (PDF)
                </a>
              )}
            </div>
          )
        })}
      </div>
      {payment.status === 'waiting_verification' && <ReviewForm paymentId={payment.id} />}
      {payment.status === 'verified' && payment.jobStatus !== 'completed' && (
        <CancelRefundForm jobId={payment.jobId} />
      )}
      {payment.status === 'refund_pending' && <RefundProofForm paymentId={payment.id} />}
      {payment.status === 'refunded' && payment.refundTransferProofPath && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Bukti Refund</span>
          <span className="text-xs text-muted-foreground">
            Direfund {payment.refundedAt ? new Date(payment.refundedAt).toLocaleString('id-ID') : '-'}
          </span>
          {!refundProofSignedUrl && <p className="text-sm text-destructive">Gagal memuat bukti refund.</p>}
          {refundProofSignedUrl && isRefundProofImage && (
            // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not a static/optimizable asset
            <img src={refundProofSignedUrl} alt="Bukti refund" className="max-w-full rounded border" />
          )}
          {refundProofSignedUrl && !isRefundProofImage && (
            <a
              href={refundProofSignedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Lihat Bukti Refund (PDF)
            </a>
          )}
        </div>
      )}
    </div>
  )
}
