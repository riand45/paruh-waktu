'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const STATUSES = [
  'draft',
  'open',
  'assigned',
  'waiting_payment',
  'payment_review',
  'payment_verified',
  'in_progress',
  'waiting_confirmation',
  'completed',
  'cancelled',
  'payment_rejected',
]

export function JobFilters({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') ?? '')

  function applyFilters() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (status) params.set('status', status)
    if (categoryId) params.set('categoryId', categoryId)
    router.push(`/admin/jobs?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Cari judul pekerjaan..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Kategori</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="button" onClick={applyFilters}>
        Terapkan Filter
      </Button>
    </div>
  )
}
