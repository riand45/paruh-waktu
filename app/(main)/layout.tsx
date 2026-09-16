import { getCurrentUser } from '@/lib/auth/get-current-user'
import { BottomNav } from '@/components/shared/bottom-nav'
import { cn } from '@/lib/utils'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser()

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <div className={cn('flex-1', user && 'pb-16')}>{children}</div>
      {user && <BottomNav />}
    </div>
  )
}
