'use client'

import { useActionState } from 'react'
import { rejectApplicationAction, selectWorkerAction } from './actions'
import { Button } from '@/components/ui/button'

interface ApplicantRowProps {
  jobId: string
  applicationId: string
  workerName: string
  message: string | null
  status: string
  appliedAt: string
  canManage: boolean
}

export function ApplicantRow({
  jobId,
  applicationId,
  workerName,
  message,
  status,
  appliedAt,
  canManage,
}: ApplicantRowProps) {
  const boundSelect = selectWorkerAction.bind(null, jobId, applicationId)
  const boundReject = rejectApplicationAction.bind(null, jobId, applicationId)
  const [selectState, selectFormAction, selectPending] = useActionState(boundSelect, undefined)
  const [rejectState, rejectFormAction, rejectPending] = useActionState(boundReject, undefined)

  return (
    <li className="flex flex-col gap-2 rounded border p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">{workerName}</span>
        <span className="text-muted-foreground">{status}</span>
      </div>
      {message && <p className="text-muted-foreground">{message}</p>}
      <span className="text-xs text-muted-foreground">
        Melamar pada {new Date(appliedAt).toLocaleString('id-ID')}
      </span>
      {canManage && status === 'pending' && (
        <div className="flex gap-2">
          <form action={selectFormAction}>
            <Button type="submit" size="sm" disabled={selectPending || rejectPending}>
              {selectPending ? 'Memilih...' : 'Pilih Pekerja Ini'}
            </Button>
          </form>
          <form action={rejectFormAction}>
            <Button type="submit" variant="outline" size="sm" disabled={selectPending || rejectPending}>
              {rejectPending ? 'Menolak...' : 'Tolak'}
            </Button>
          </form>
        </div>
      )}
      {selectState && !selectState.success && (
        <p className="text-sm text-destructive">{selectState.message}</p>
      )}
      {rejectState && !rejectState.success && (
        <p className="text-sm text-destructive">{rejectState.message}</p>
      )}
    </li>
  )
}
