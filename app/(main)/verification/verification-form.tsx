'use client'

import { useActionState } from 'react'
import { submitEmployerVerificationAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function VerificationForm() {
  const [state, action, pending] = useActionState(submitEmployerVerificationAction, undefined)

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullNameOnKtp">Nama Lengkap (sesuai KTP)</Label>
        <Input id="fullNameOnKtp" name="fullNameOnKtp" required />
        {state?.errors?.fullNameOnKtp && (
          <p className="text-sm text-destructive">{state.errors.fullNameOnKtp[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ktpNumber">Nomor KTP</Label>
        <Input id="ktpNumber" name="ktpNumber" inputMode="numeric" required />
        {state?.errors?.ktpNumber && (
          <p className="text-sm text-destructive">{state.errors.ktpNumber[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ktpDocument">Foto/Scan KTP</Label>
        <Input
          id="ktpDocument"
          name="ktpDocument"
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          required
        />
        {state?.errors?.file && (
          <p className="text-sm text-destructive">{state.errors.file[0]}</p>
        )}
      </div>
      {state?.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengirim...' : 'Ajukan Verifikasi'}
      </Button>
    </form>
  )
}
