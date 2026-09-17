'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'

export function JobsViewToggle() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view') === 'map' ? 'map' : 'list'

  function hrefFor(nextView: 'list' | 'map') {
    const params = new URLSearchParams(searchParams.toString())
    if (nextView === 'list') {
      params.delete('view')
    } else {
      params.set('view', nextView)
    }
    const query = params.toString()
    return query ? `/jobs?${query}` : '/jobs'
  }

  return (
    <div className="flex gap-2">
      <Link
        href={hrefFor('list')}
        className={cn(
          'rounded-md border px-3 py-1.5 text-sm',
          view === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background'
        )}
      >
        Daftar
      </Link>
      <Link
        href={hrefFor('map')}
        className={cn(
          'rounded-md border px-3 py-1.5 text-sm',
          view === 'map' ? 'bg-primary text-primary-foreground' : 'bg-background'
        )}
      >
        Peta
      </Link>
    </div>
  )
}
