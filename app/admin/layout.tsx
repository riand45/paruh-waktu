import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/get-current-user'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    await requireRole('admin')
  } catch {
    notFound()
  }

  return <>{children}</>
}
