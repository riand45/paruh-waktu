'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reviewEmployerVerificationAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ReviewForm({ verificationId }: { verificationId: string }) {
  const router = useRouter()
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDecision(decision: 'approved' | 'rejected') {
    setError(null)
    if (decision === 'rejected' && rejectionReason.trim().length === 0) {
      setError('Alasan penolakan wajib diisi.')
      return
    }
    startTransition(async () => {
      const result = await reviewEmployerVerificationAction(
        verificationId,
        decision,
        decision === 'rejected' ? rejectionReason : undefined
      )
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/employer-verifications')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rejectionReason">Alasan Penolakan (wajib jika menolak)</Label>
        <Input
          id="rejectionReason"
          value={rejectionReason}
          onChange={(event) => setRejectionReason(event.target.value)}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" disabled={isPending} onClick={() => handleDecision('approved')}>
          {isPending ? 'Memproses...' : 'Setujui'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isPending}
          onClick={() => handleDecision('rejected')}
        >
          {isPending ? 'Memproses...' : 'Tolak'}
        </Button>
      </div>
    </div>
  )
}
