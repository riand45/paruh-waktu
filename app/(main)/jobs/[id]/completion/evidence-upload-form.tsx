'use client'

import { useActionState } from 'react'
import { recordJobEvidenceAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function EvidenceUploadForm({ jobId }: { jobId: string }) {
  const boundAction = recordJobEvidenceAction.bind(null, jobId)
  const [state, formAction, pending] = useActionState(boundAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="file">Bukti Pekerjaan (Foto/Video)</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          required
        />
        {state?.errors?.file && <p className="text-sm text-destructive">{state.errors.file[0]}</p>}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Mengunggah...' : 'Unggah Bukti'}
      </Button>
    </form>
  )
}
