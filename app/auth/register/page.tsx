'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { registerAction } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function RegisterPage() {
  const [state, action, pending] = useActionState(registerAction, undefined)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-xl font-semibold">Daftar Akun</h1>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="fullName">Nama Lengkap</Label>
          <Input id="fullName" name="fullName" required />
          {state?.errors?.fullName && (
            <p className="text-sm text-destructive">{state.errors.fullName[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
          {state?.errors?.email && (
            <p className="text-sm text-destructive">{state.errors.email[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Nomor Telepon</Label>
          <Input id="phone" name="phone" type="tel" required />
          {state?.errors?.phone && (
            <p className="text-sm text-destructive">{state.errors.phone[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
          {state?.errors?.password && (
            <p className="text-sm text-destructive">{state.errors.password[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Konfirmasi Password</Label>
          <Input id="confirmPassword" name="confirmPassword" type="password" required />
          {state?.errors?.confirmPassword && (
            <p className="text-sm text-destructive">
              {state.errors.confirmPassword[0]}
            </p>
          )}
        </div>
        {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Memproses...' : 'Daftar'}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Sudah punya akun?{' '}
        <Link href="/auth/login" className="text-primary underline-offset-4 hover:underline">
          Masuk
        </Link>
      </p>
    </div>
  )
}
