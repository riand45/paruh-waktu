'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toggleCategoryActiveAction } from './actions'
import { Button } from '@/components/ui/button'

export function ToggleActiveButton({ categoryId, isActive }: { categoryId: string; isActive: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await toggleCategoryActiveAction(categoryId, !isActive)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
        {isPending ? '...' : isActive ? 'Nonaktifkan' : 'Aktifkan'}
      </Button>
    </div>
  )
}
