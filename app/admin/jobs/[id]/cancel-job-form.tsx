'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type CancelAction = (
  jobId: string,
  reason: string
) => Promise<{ success: true } | { success: false; message: string }>

export function CancelJobForm({
  jobId,
  action,
  label,
}: {
  jobId: string
  action: CancelAction
  label: string
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleCancel() {
    setError(null)
    if (reason.trim().length === 0) {
      setError('Alasan pembatalan wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = await action(jobId, reason)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded border p-3">
      <span className="text-sm font-medium">Batalkan Pekerjaan</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Alasan Pembatalan</Label>
        <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" variant="outline" disabled={isPending} onClick={handleCancel}>
        {isPending ? 'Memproses...' : label}
      </Button>
    </div>
  )
}
