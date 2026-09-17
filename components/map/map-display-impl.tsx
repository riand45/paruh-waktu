'use client'

import { Marker } from 'react-leaflet'
import { BaseMap } from './base-map'

export function MapDisplay({ latitude, longitude }: { latitude: number; longitude: number }) {
  return (
    <BaseMap center={[latitude, longitude]} zoom={15} className="h-48 w-full rounded-md">
      <Marker position={[latitude, longitude]} />
    </BaseMap>
  )
}
