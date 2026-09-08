import Link from 'next/link'
import { getOwnProfile } from '@/lib/services/profiles'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { logoutAction } from '@/app/auth/actions'
import { AvatarUploader } from './avatar-uploader'
import { ProfileForm } from './profile-form'
import { Button } from '@/components/ui/button'

export default async function ProfilePage() {
  const profile = await getOwnProfile()
  const currentUser = await getCurrentUser()
  const isEmployer = currentUser?.roles.includes('employer') ?? false

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Profil Saya</h1>
        <form action={logoutAction}>
          <Button type="submit" variant="outline" size="sm">
            Keluar
          </Button>
        </form>
      </div>
      <AvatarUploader userId={profile.id} currentAvatarUrl={profile.avatarUrl} />
      <Link href="/verification" className="text-sm text-primary underline-offset-4 hover:underline">
        Ajukan jadi Pemberi Kerja
      </Link>
      <Link href="/jobs" className="text-sm text-primary underline-offset-4 hover:underline">
        Cari Pekerjaan
      </Link>
      {isEmployer && (
        <>
          <Link href="/jobs/new" className="text-sm text-primary underline-offset-4 hover:underline">
            Buat Pekerjaan
          </Link>
          <Link href="/jobs/mine" className="text-sm text-primary underline-offset-4 hover:underline">
            Pekerjaan Saya
          </Link>
        </>
      )}
      <ProfileForm profile={profile} />
    </div>
  )
}
