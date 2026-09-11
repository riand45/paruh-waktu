import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireAdminOr404, getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserDetailForAdmin } from '@/lib/services/admin-users'
import { SuspendActivateButton } from './suspend-activate-button'

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const user = await getUserDetailForAdmin(id)
  if (!user) {
    notFound()
  }

  const currentUser = await getCurrentUser()
  const isSelf = currentUser?.id === user.id

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">{user.fullName}</h1>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email ?? '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{user.roles.join(', ') || '-'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Status Akun</dt>
          <dd>{user.accountStatus}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Bergabung</dt>
          <dd>{new Date(user.createdAt).toLocaleString('id-ID')}</dd>
        </div>
      </dl>
      {user.latestVerificationId && (
        <Link
          href={`/admin/employer-verifications/${user.latestVerificationId}`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Lihat Status Verifikasi Employer
        </Link>
      )}
      {!isSelf && <SuspendActivateButton userId={user.id} accountStatus={user.accountStatus} />}
    </div>
  )
}
