'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { loginAction } from '@/app/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, undefined)

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4">
      <h1 className="text-xl font-semibold">Masuk</h1>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required />
          {state?.errors?.email && (
            <p className="text-sm text-destructive">{state.errors.email[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
          {state?.errors?.password && (
            <p className="text-sm text-destructive">{state.errors.password[0]}</p>
          )}
        </div>
        {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
        <Button type="submit" disabled={pending}>
          {pending ? 'Memproses...' : 'Masuk'}
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Belum punya akun?{' '}
        <Link href="/auth/register" className="text-primary underline-offset-4 hover:underline">
          Daftar
        </Link>
      </p>
    </div>
  )
}
