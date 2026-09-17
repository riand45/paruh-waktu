'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Marker, Popup, useMap } from 'react-leaflet'
import { BaseMap, INDONESIA_CENTER, INDONESIA_DEFAULT_ZOOM } from './base-map'

export interface JobMapPin {
  id: string
  title: string
  paymentAmount: number
  distanceKm: number | null
  latitude: number
  longitude: number
}

function FitToPins({ pins }: { pins: JobMapPin[] }) {
  const map = useMap()
  useEffect(() => {
    if (pins.length === 0) return
    if (pins.length === 1) {
      map.setView([pins[0].latitude, pins[0].longitude], 14)
      return
    }
    map.fitBounds(
      pins.map((pin): [number, number] => [pin.latitude, pin.longitude]),
      { padding: [32, 32] }
    )
  }, [map, pins])
  return null
}

export function JobsMap({ jobs }: { jobs: JobMapPin[] }) {
  return (
    <BaseMap center={INDONESIA_CENTER} zoom={INDONESIA_DEFAULT_ZOOM} className="h-96 w-full rounded-md">
      <FitToPins pins={jobs} />
      {jobs.map((job) => (
        <Marker key={job.id} position={[job.latitude, job.longitude]}>
          <Popup>
            <div className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{job.title}</span>
              <span>Rp{job.paymentAmount.toLocaleString('id-ID')}</span>
              {job.distanceKm !== null && <span>{job.distanceKm.toFixed(1)} km</span>}
              <Link href={`/jobs/${job.id}`} className="text-primary underline-offset-4 hover:underline">
                Lihat Detail
              </Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </BaseMap>
  )
}
