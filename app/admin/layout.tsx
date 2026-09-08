import { requireAdminOr404 } from '@/lib/auth/get-current-user'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminOr404()

  return <>{children}</>
}
