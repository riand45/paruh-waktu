import { Suspense } from 'react'
import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getUsersForAdmin } from '@/lib/services/admin-users'
import type { AppRole } from '@/lib/auth/has-role'
import { UserFilters } from './user-filters'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; role?: string; status?: string }>
}) {
  await requireAdminOr404()
  const { search, role, status } = await searchParams

  const users = await getUsersForAdmin({
    search,
    role: role as AppRole | undefined,
    status: status as 'active' | 'suspended' | undefined,
  })

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pengguna</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Memuat filter...</p>}>
        <UserFilters />
      </Suspense>
      {users.length === 0 && <p className="text-sm text-muted-foreground">Tidak ada pengguna ditemukan.</p>}
      <ul className="flex flex-col gap-2">
        {users.map((user) => (
          <li key={user.id}>
            <Link
              href={`/admin/users/${user.id}`}
              className="flex items-center justify-between rounded border p-3 text-sm hover:bg-muted"
            >
              <div className="flex flex-col">
                <span className="font-medium">{user.fullName}</span>
                <span className="text-muted-foreground">{user.email ?? '-'}</span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span>{user.roles.join(', ') || '-'}</span>
                <span className="text-muted-foreground">{user.accountStatus}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
