'use client'

import { useActionState } from 'react'
import { requestWithdrawalAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function RequestWithdrawalForm({ balance }: { balance: number }) {
  const [state, action, pending] = useActionState(requestWithdrawalAction, undefined)

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="amount">Jumlah (maks. Rp{balance.toLocaleString('id-ID')})</Label>
        <Input id="amount" name="amount" type="number" min="1" max={balance} step="1" required />
        {state?.errors?.amount && <p className="text-sm text-destructive">{state.errors.amount[0]}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bankName">Nama Bank</Label>
        <Input id="bankName" name="bankName" required />
        {state?.errors?.bankName && <p className="text-sm text-destructive">{state.errors.bankName[0]}</p>}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accountNumber">Nomor Rekening</Label>
        <Input id="accountNumber" name="accountNumber" required />
        {state?.errors?.accountNumber && (
          <p className="text-sm text-destructive">{state.errors.accountNumber[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="accountHolderName">Nama Pemilik Rekening</Label>
        <Input id="accountHolderName" name="accountHolderName" required />
        {state?.errors?.accountHolderName && (
          <p className="text-sm text-destructive">{state.errors.accountHolderName[0]}</p>
        )}
      </div>
      {state?.message && (
        <p
          className={
            state.status === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
          }
        >
          {state.message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengajukan...' : 'Ajukan Withdrawal'}
      </Button>
    </form>
  )
}
