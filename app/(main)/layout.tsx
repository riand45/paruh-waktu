import { getCurrentUser } from '@/lib/auth/get-current-user'
import { BottomNav } from '@/components/shared/bottom-nav'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1 pb-16">{children}</div>
      {user && <BottomNav />}
    </div>
  )
}
