'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { confirmJobCompletionAction } from './actions'
import { Button } from '@/components/ui/button'

export function ConfirmCompletionButton({ jobId }: { jobId: string }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleConfirm() {
    setError(null)
    startTransition(async () => {
      const result = await confirmJobCompletionAction(jobId)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" disabled={isPending} onClick={handleConfirm}>
        {isPending ? 'Memproses...' : 'Konfirmasi Selesai'}
      </Button>
    </div>
  )
}
