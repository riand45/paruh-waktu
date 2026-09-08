'use client'

import { useActionState } from 'react'
import type { JobFormState } from '@/lib/validations/job'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface JobCategoryOption {
  id: string
  name: string
}

interface JobFormDefaultValues {
  title: string
  categoryId: string
  description: string
  address: string
  latitude: string
  longitude: string
  paymentAmount: string
  durationMinutes: string
  deadline: string
}

export function JobForm({
  action,
  categories,
  defaultValues,
  submitLabel,
}: {
  action: (prevState: JobFormState, formData: FormData) => Promise<JobFormState>
  categories: JobCategoryOption[]
  defaultValues?: JobFormDefaultValues
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState(action, undefined)

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Judul Pekerjaan</Label>
        <Input id="title" name="title" defaultValue={defaultValues?.title} required />
        {state?.errors?.title && (
          <p className="text-sm text-destructive">{state.errors.title[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="categoryId">Kategori</Label>
        <select
          id="categoryId"
          name="categoryId"
          defaultValue={defaultValues?.categoryId ?? ''}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          required
        >
          <option value="" disabled>
            Pilih kategori
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        {state?.errors?.categoryId && (
          <p className="text-sm text-destructive">{state.errors.categoryId[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Deskripsi</Label>
        <textarea
          id="description"
          name="description"
          defaultValue={defaultValues?.description}
          className="rounded-md border bg-background px-3 py-2 text-sm"
          rows={4}
          required
        />
        {state?.errors?.description && (
          <p className="text-sm text-destructive">{state.errors.description[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="address">Alamat</Label>
        <Input id="address" name="address" defaultValue={defaultValues?.address} required />
        {state?.errors?.address && (
          <p className="text-sm text-destructive">{state.errors.address[0]}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="latitude">Latitude</Label>
          <Input
            id="latitude"
            name="latitude"
            type="number"
            step="any"
            defaultValue={defaultValues?.latitude}
            required
          />
          {state?.errors?.latitude && (
            <p className="text-sm text-destructive">{state.errors.latitude[0]}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="longitude">Longitude</Label>
          <Input
            id="longitude"
            name="longitude"
            type="number"
            step="any"
            defaultValue={defaultValues?.longitude}
            required
          />
          {state?.errors?.longitude && (
            <p className="text-sm text-destructive">{state.errors.longitude[0]}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="paymentAmount">Nominal Pembayaran (Rp)</Label>
        <Input
          id="paymentAmount"
          name="paymentAmount"
          type="number"
          step="any"
          defaultValue={defaultValues?.paymentAmount}
          required
        />
        {state?.errors?.paymentAmount && (
          <p className="text-sm text-destructive">{state.errors.paymentAmount[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="durationMinutes">Durasi (menit)</Label>
        <Input
          id="durationMinutes"
          name="durationMinutes"
          type="number"
          defaultValue={defaultValues?.durationMinutes}
          required
        />
        {state?.errors?.durationMinutes && (
          <p className="text-sm text-destructive">{state.errors.durationMinutes[0]}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="deadline">Deadline</Label>
        <Input
          id="deadline"
          name="deadline"
          type="datetime-local"
          defaultValue={defaultValues?.deadline}
          required
        />
        {state?.errors?.deadline && (
          <p className="text-sm text-destructive">{state.errors.deadline[0]}</p>
        )}
      </div>
      {state?.message && <p className="text-sm text-destructive">{state.message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Menyimpan...' : submitLabel}
      </Button>
    </form>
  )
}
