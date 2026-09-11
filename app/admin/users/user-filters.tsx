'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function UserFilters() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(searchParams.get('search') ?? '')
  const [role, setRole] = useState(searchParams.get('role') ?? '')
  const [status, setStatus] = useState(searchParams.get('status') ?? '')

  function applyFilters() {
    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (role) params.set('role', role)
    if (status) params.set('status', status)
    router.push(`/admin/users?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Cari nama atau email..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={role}
          onChange={(event) => setRole(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Role</option>
          <option value="worker">Worker</option>
          <option value="employer">Employer</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>
      <Button type="button" onClick={applyFilters}>
        Terapkan Filter
      </Button>
    </div>
  )
}
