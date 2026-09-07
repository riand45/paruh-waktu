import Link from 'next/link'

export default function RegisterSuccessPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Periksa Email Anda</h1>
      <p className="text-sm text-muted-foreground">
        Kami telah mengirimkan tautan konfirmasi ke email Anda. Silakan klik
        tautan tersebut untuk mengaktifkan akun Anda.
      </p>
      <Link
        href="/auth/login"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Kembali ke halaman masuk
      </Link>
    </div>
  )
}
