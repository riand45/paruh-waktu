'use client'

import { useActionState } from 'react'
import { applyToJobAction } from './actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

export function ApplyForm({ jobId }: { jobId: string }) {
  const boundAction = applyToJobAction.bind(null, jobId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <Label htmlFor="message">Pesan (opsional)</Label>
      <Textarea
        id="message"
        name="message"
        placeholder="Ceritakan mengapa Anda cocok untuk pekerjaan ini..."
        rows={3}
      />
      {state?.errors?.message && <p className="text-sm text-destructive">{state.errors.message[0]}</p>}
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengirim...' : 'Lamar Pekerjaan'}
      </Button>
    </form>
  )
}
