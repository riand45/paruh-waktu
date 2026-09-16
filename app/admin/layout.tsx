import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminOr404()

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <AdminSidebar />
      <div className="flex-1">{children}</div>
    </div>
  )
}
