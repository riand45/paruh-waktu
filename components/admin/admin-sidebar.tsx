'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Briefcase,
  Receipt,
  ArrowLeftRight,
  Tag,
  Settings,
  ScrollText,
  ArrowLeft,
  Menu,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AdminSection {
  href: string
  label: string
  icon: LucideIcon
  exact?: boolean
}

const SECTIONS: AdminSection[] = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/admin/users', label: 'Pengguna', icon: Users },
  { href: '/admin/employer-verifications', label: 'Verifikasi Employer', icon: ShieldCheck },
  { href: '/admin/jobs', label: 'Pekerjaan', icon: Briefcase },
  { href: '/admin/payments', label: 'Pembayaran', icon: Receipt },
  { href: '/admin/withdrawals', label: 'Withdrawal', icon: ArrowLeftRight },
  { href: '/admin/categories', label: 'Kategori', icon: Tag },
  { href: '/admin/settings', label: 'Pengaturan', icon: Settings },
  { href: '/admin/audit-logs', label: 'Audit Log', icon: ScrollText },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  function isActive(section: AdminSection): boolean {
    return section.exact ? pathname === section.href : pathname.startsWith(section.href)
  }

  return (
    <div className="border-b md:w-56 md:flex-shrink-0 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:hidden">
        <span className="text-sm font-semibold">Admin Panel</span>
        <button type="button" onClick={() => setIsOpen((open) => !open)} aria-label="Buka menu admin">
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      <nav className={cn('flex-col gap-1 p-3 md:flex', isOpen ? 'flex' : 'hidden')}>
        {SECTIONS.map((section) => {
          const Icon = section.icon
          return (
            <Link
              key={section.href}
              href={section.href}
              className={cn(
                'flex items-center gap-2 rounded px-3 py-2 text-sm',
                isActive(section) ? 'bg-muted font-medium' : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <Icon className="h-4 w-4" />
              {section.label}
            </Link>
          )
        })}
        <Link
          href="/jobs"
          className="mt-4 flex items-center gap-2 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali ke Aplikasi
        </Link>
      </nav>
    </div>
  )
}
