'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function JobFilters({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [keyword, setKeyword] = useState(searchParams.get('keyword') ?? '')
  const [category, setCategory] = useState(searchParams.get('category') ?? '')
  const [minPayment, setMinPayment] = useState(searchParams.get('minPayment') ?? '')
  const [maxPayment, setMaxPayment] = useState(searchParams.get('maxPayment') ?? '')
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  function applyFilters(extra?: Record<string, string>) {
    const params = new URLSearchParams()
    if (keyword) params.set('keyword', keyword)
    if (category) params.set('category', category)
    if (minPayment) params.set('minPayment', minPayment)
    if (maxPayment) params.set('maxPayment', maxPayment)

    const existingLat = searchParams.get('lat')
    const existingLng = searchParams.get('lng')
    if (existingLat) params.set('lat', existingLat)
    if (existingLng) params.set('lng', existingLng)

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        params.set(key, value)
      }
    }

    router.push(`/jobs?${params.toString()}`)
  }

  function clearLocation() {
    const params = new URLSearchParams()
    if (keyword) params.set('keyword', keyword)
    if (category) params.set('category', category)
    if (minPayment) params.set('minPayment', minPayment)
    if (maxPayment) params.set('maxPayment', maxPayment)
    router.push(`/jobs?${params.toString()}`)
  }

  function handleNearMe() {
    setLocationError(null)
    if (!navigator.geolocation) {
      setLocationError('Browser Anda tidak mendukung deteksi lokasi.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        applyFilters({
          lat: String(position.coords.latitude),
          lng: String(position.coords.longitude),
        })
      },
      () => {
        setLocating(false)
        setLocationError('Izin lokasi ditolak atau gagal mendeteksi lokasi.')
      }
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Cari judul pekerjaan..."
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <select
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        className="rounded-md border bg-background px-3 py-2 text-sm"
      >
        <option value="">Semua Kategori</option>
        {categories.map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name}
          </option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          placeholder="Nominal min"
          value={minPayment}
          onChange={(event) => setMinPayment(event.target.value)}
        />
        <Input
          type="number"
          placeholder="Nominal maks"
          value={maxPayment}
          onChange={(event) => setMaxPayment(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="button" onClick={() => applyFilters()}>
          Terapkan Filter
        </Button>
        <Button type="button" variant="outline" onClick={handleNearMe} disabled={locating}>
          {locating ? 'Mendeteksi...' : 'Terdekat'}
        </Button>
        {searchParams.get('lat') && (
          <Button type="button" variant="outline" onClick={clearLocation}>
            Semua Lokasi
          </Button>
        )}
      </div>
      {locationError && <p className="text-sm text-destructive">{locationError}</p>}
    </div>
  )
}
