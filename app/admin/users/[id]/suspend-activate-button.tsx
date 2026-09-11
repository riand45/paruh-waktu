'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { suspendUserAction, activateUserAction } from '../actions'
import { Button } from '@/components/ui/button'

export function SuspendActivateButton({
  userId,
  accountStatus,
}: {
  userId: string
  accountStatus: string
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const action = accountStatus === 'suspended' ? activateUserAction : suspendUserAction
      const result = await action(userId)
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
      <Button type="button" variant="outline" disabled={isPending} onClick={handleClick}>
        {isPending
          ? 'Memproses...'
          : accountStatus === 'suspended'
            ? 'Aktifkan Pengguna'
            : 'Suspend Pengguna'}
      </Button>
    </div>
  )
}
