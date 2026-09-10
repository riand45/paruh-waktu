'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { processWithdrawalAction, rejectWithdrawalAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ProcessRejectForm({ withdrawalId }: { withdrawalId: string }) {
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleProcess() {
    setError(null)
    startTransition(async () => {
      const result = await processWithdrawalAction(withdrawalId)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  function handleReject() {
    setError(null)
    if (rejectionReason.trim().length === 0) {
      setError('Alasan penolakan wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = await rejectWithdrawalAction(withdrawalId, rejectionReason)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/withdrawals')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rejectionReason">Alasan Penolakan (jika ditolak)</Label>
        <Input
          id="rejectionReason"
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={isPending} onClick={handleProcess}>
          {isPending ? 'Memproses...' : 'Proses'}
        </Button>
        <Button type="button" variant="outline" disabled={isPending} onClick={handleReject}>
          {isPending ? 'Memproses...' : 'Tolak'}
        </Button>
      </div>
    </div>
  )
}
