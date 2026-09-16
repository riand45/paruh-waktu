'use client'

import { useActionState } from 'react'
import { submitPaymentProofAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function PaymentProofForm({ paymentId, jobId }: { paymentId: string; jobId: string }) {
  const boundAction = submitPaymentProofAction.bind(null, paymentId, jobId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="transferDate">Tanggal Transfer</Label>
        <Input id="transferDate" name="transferDate" type="date" required />
        {state?.errors?.transferDate && (
          <p className="text-sm text-destructive">{state.errors.transferDate[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Transfer</Label>
        <Input id="file" name="file" type="file" accept="image/jpeg,image/png,application/pdf" required />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Kirim Bukti Transfer'}
      </Button>
    </form>
  )
}
