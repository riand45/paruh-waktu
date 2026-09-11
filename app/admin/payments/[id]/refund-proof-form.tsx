'use client'

import { useActionState } from 'react'
import { markRefundPaidAction } from '../actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RefundProofForm({ paymentId }: { paymentId: string }) {
  const boundAction = markRefundPaidAction.bind(null, paymentId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded border p-3">
      <span className="text-sm font-medium">Unggah Bukti Transfer Refund</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Transfer</Label>
        <Input id="file" name="file" type="file" accept="image/jpeg,image/png,application/pdf" required />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Tandai Refund Selesai'}
      </Button>
    </form>
  )
}
