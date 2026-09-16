'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Briefcase, ClipboardList, MessageCircle, Wallet, User } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavTab {
  href: string
  label: string
  icon: LucideIcon
}

const TABS: NavTab[] = [
  { href: '/jobs', label: 'Pekerjaan', icon: Briefcase },
  { href: '/applications/mine', label: 'Lamaran', icon: ClipboardList },
  { href: '/chat', label: 'Chat', icon: MessageCircle },
  { href: '/wallet', label: 'Wallet', icon: Wallet },
  { href: '/profile', label: 'Profil', icon: User },
]

export function BottomNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-between">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center gap-1 py-2 text-xs',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
