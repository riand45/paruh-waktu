'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type * as L from 'leaflet'
import { Marker } from 'react-leaflet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BaseMap, MapClickHandler, INDONESIA_CENTER, INDONESIA_DEFAULT_ZOOM } from './base-map'

export interface MapPickerValue {
  address: string
  latitude: string
  longitude: string
}

const GEOCODE_DEBOUNCE_MS = 500

export function MapPicker({
  value,
  onChange,
}: {
  value: MapPickerValue
  onChange: (next: MapPickerValue) => void
}) {
  const [searching, setSearching] = useState(false)
  const [locating, setLocating] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const hasPosition = value.latitude !== '' && value.longitude !== ''
  const center: [number, number] = hasPosition
    ? [Number(value.latitude), Number(value.longitude)]
    : INDONESIA_CENTER
  const zoom = hasPosition ? 15 : INDONESIA_DEFAULT_ZOOM

  const runReverseGeocode = useCallback(
    async (latitude: number, longitude: number) => {
      setMapError(null)
      try {
        const response = await fetch(`/api/reverse-geocode?lat=${latitude}&lon=${longitude}`)
        const data: { address?: string; error?: string } = await response.json()
        if (!response.ok || !data.address) {
          setMapError(data.error ?? 'Gagal menghubungi layanan peta, coba lagi.')
          onChange({ ...value, latitude: String(latitude), longitude: String(longitude) })
          return
        }
        onChange({ address: data.address, latitude: String(latitude), longitude: String(longitude) })
      } catch {
        setMapError('Gagal menghubungi layanan peta, coba lagi.')
        onChange({ ...value, latitude: String(latitude), longitude: String(longitude) })
      }
    },
    [onChange, value]
  )

  function handleMapClick(latitude: number, longitude: number) {
    void runReverseGeocode(latitude, longitude)
  }

  function handleMarkerDragEnd(event: L.DragEndEvent) {
    const marker = event.target as L.Marker
    const { lat, lng } = marker.getLatLng()
    void runReverseGeocode(lat, lng)
  }

  function handleAddressChange(nextAddress: string) {
    onChange({ ...value, address: nextAddress })

    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (nextAddress.trim().length === 0) return

    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setMapError(null)
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(nextAddress)}`)
        const data: { address?: string; latitude?: number; longitude?: number; error?: string } =
          await response.json()
        if (!response.ok || data.latitude === undefined || data.longitude === undefined || !data.address) {
          setMapError(
            data.error ?? 'Alamat tidak ditemukan, coba kata kunci lain atau klik langsung di peta.'
          )
          return
        }
        onChange({ address: data.address, latitude: String(data.latitude), longitude: String(data.longitude) })
      } catch {
        setMapError('Gagal menghubungi layanan peta, coba lagi.')
      } finally {
        setSearching(false)
      }
    }, GEOCODE_DEBOUNCE_MS)
  }

  function handleUseMyLocation() {
    setMapError(null)
    if (!navigator.geolocation) {
      setMapError('Browser Anda tidak mendukung deteksi lokasi.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        void runReverseGeocode(position.coords.latitude, position.coords.longitude)
      },
      () => {
        setLocating(false)
        setMapError('Izin lokasi ditolak atau gagal mendeteksi lokasi.')
      }
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1.5">
        <Input
          placeholder="Cari alamat atau klik di peta..."
          value={value.address}
          onChange={(event) => handleAddressChange(event.target.value)}
        />
        {searching && <p className="text-xs text-muted-foreground">Mencari alamat...</p>}
      </div>
      <BaseMap center={center} zoom={zoom} className="h-64 w-full rounded-md">
        <MapClickHandler onClick={handleMapClick} />
        {hasPosition && (
          <Marker
            position={center}
            draggable
            eventHandlers={{ dragend: handleMarkerDragEnd }}
          />
        )}
      </BaseMap>
      <Button type="button" variant="outline" onClick={handleUseMyLocation} disabled={locating}>
        {locating ? 'Mendeteksi...' : 'Gunakan Lokasi Saya'}
      </Button>
      {mapError && <p className="text-sm text-destructive">{mapError}</p>}
    </div>
  )
}
