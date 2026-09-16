import Link from 'next/link'
import { getLatestEmployerVerification } from '@/lib/services/employer-verifications'
import { VerificationForm } from './verification-form'

export default async function VerificationPage() {
  const verification = await getLatestEmployerVerification()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Verifikasi Pemberi Kerja</h1>

      {verification?.status === 'pending' && (
        <p className="text-sm text-muted-foreground">
          Pengajuan Anda sedang menunggu peninjauan Admin.
        </p>
      )}

      {verification?.status === 'approved' && (
        <p className="text-sm text-muted-foreground">
          Anda sudah terverifikasi sebagai Pemberi Kerja.
        </p>
      )}

      {verification?.status === 'rejected' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-destructive">
            Pengajuan sebelumnya ditolak
            {verification.rejectionReason ? `: ${verification.rejectionReason}` : '.'}
          </p>
          <VerificationForm />
        </div>
      )}

      {!verification && (
        <>
          <p className="text-sm text-muted-foreground">
            Ajukan verifikasi untuk dapat membuat pekerjaan sebagai Pemberi Kerja.
          </p>
          <VerificationForm />
        </>
      )}

      <Link href="/profile" className="text-sm text-primary underline-offset-4 hover:underline">
        Kembali ke profil
      </Link>
    </div>
  )
}
