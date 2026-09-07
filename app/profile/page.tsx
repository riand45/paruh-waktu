import { getOwnProfile } from '@/lib/services/profiles'
import { logoutAction } from '@/app/auth/actions'
import { ProfileForm } from './profile-form'
import { Button } from '@/components/ui/button'

export default async function ProfilePage() {
  const profile = await getOwnProfile()

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
      <ProfileForm profile={profile} />
    </div>
  )
}
