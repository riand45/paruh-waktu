'use client'

import { useActionState } from 'react'
import { updateProfileAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { OwnProfile } from '@/lib/services/profiles'

export function ProfileForm({ profile }: { profile: OwnProfile }) {
  const [state, action, pending] = useActionState(updateProfileAction, undefined)

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="fullName">Nama Lengkap</Label>
        <Input id="fullName" name="fullName" defaultValue={profile.fullName} required />
        {state?.errors?.fullName && (
          <p className="text-sm text-destructive">{state.errors.fullName[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Nomor Telepon</Label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          defaultValue={profile.phone ?? ''}
          required
        />
        {state?.errors?.phone && (
          <p className="text-sm text-destructive">{state.errors.phone[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Alamat</Label>
        <Input id="address" name="address" defaultValue={profile.address ?? ''} />
        {state?.errors?.address && (
          <p className="text-sm text-destructive">{state.errors.address[0]}</p>
        )}
      </div>
      {state?.message && <p className="text-sm text-muted-foreground">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan Perubahan'}
      </Button>
    </form>
  )
}
