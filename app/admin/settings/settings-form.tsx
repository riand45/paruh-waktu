'use client'

import { useActionState } from 'react'
import { updateSettingsAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { PlatformSettingsInput } from '@/lib/validations/platform-settings'

export function SettingsForm({ initial }: { initial: PlatformSettingsInput }) {
  const [state, formAction, pending] = useActionState(updateSettingsAction, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded border p-3">
        <span className="text-sm font-medium">Pembayaran</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platformFeePercentage">Platform Fee (%)</Label>
          <Input
            id="platformFeePercentage"
            name="platformFeePercentage"
            type="number"
            step="0.01"
            defaultValue={initial.platformFeePercentage}
          />
          {state?.errors?.platformFeePercentage && (
            <p className="text-sm text-destructive">{state.errors.platformFeePercentage[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platformFeePayer">Fee Payer</Label>
          <select
            id="platformFeePayer"
            name="platformFeePayer"
            defaultValue={initial.platformFeePayer}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="employer">Employer</option>
            <option value="worker">Worker</option>
            <option value="split">Split</option>
          </select>
          {state?.errors?.platformFeePayer && (
            <p className="text-sm text-destructive">{state.errors.platformFeePayer[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bankName">Nama Bank</Label>
          <Input id="bankName" name="bankName" defaultValue={initial.bankName} />
          {state?.errors?.bankName && <p className="text-sm text-destructive">{state.errors.bankName[0]}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bankAccountNumber">Nomor Rekening</Label>
          <Input id="bankAccountNumber" name="bankAccountNumber" defaultValue={initial.bankAccountNumber} />
          {state?.errors?.bankAccountNumber && (
            <p className="text-sm text-destructive">{state.errors.bankAccountNumber[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bankAccountHolderName">Atas Nama</Label>
          <Input
            id="bankAccountHolderName"
            name="bankAccountHolderName"
            defaultValue={initial.bankAccountHolderName}
          />
          {state?.errors?.bankAccountHolderName && (
            <p className="text-sm text-destructive">{state.errors.bankAccountHolderName[0]}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded border p-3">
        <span className="text-sm font-medium">Pekerjaan</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="defaultJobRadiusKm">Radius Default (km)</Label>
          <Input
            id="defaultJobRadiusKm"
            name="defaultJobRadiusKm"
            type="number"
            step="0.1"
            defaultValue={initial.defaultJobRadiusKm}
          />
          {state?.errors?.defaultJobRadiusKm && (
            <p className="text-sm text-destructive">{state.errors.defaultJobRadiusKm[0]}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded border p-3">
        <span className="text-sm font-medium">Upload</span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="maxUploadSizeMb">Ukuran Maksimal (MB)</Label>
          <Input
            id="maxUploadSizeMb"
            name="maxUploadSizeMb"
            type="number"
            step="0.1"
            defaultValue={initial.maxUploadSizeMb}
          />
          {state?.errors?.maxUploadSizeMb && (
            <p className="text-sm text-destructive">{state.errors.maxUploadSizeMb[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="allowedFileTypes">Tipe File yang Diizinkan (pisahkan dengan koma)</Label>
          <Input id="allowedFileTypes" name="allowedFileTypes" defaultValue={initial.allowedFileTypes.join(', ')} />
          {state?.errors?.allowedFileTypes && (
            <p className="text-sm text-destructive">{state.errors.allowedFileTypes[0]}</p>
          )}
        </div>
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      {state?.success && <p className="text-sm text-green-600">Pengaturan berhasil disimpan.</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan...' : 'Simpan Pengaturan'}
      </Button>
    </form>
  )
}
