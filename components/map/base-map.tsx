'use client'

import 'leaflet/dist/leaflet.css'
import * as L from 'leaflet'
import type { ReactNode } from 'react'
import { MapContainer, TileLayer, useMapEvents } from 'react-leaflet'

// react-leaflet's bundled default marker icon references image paths that
// break under most Next.js bundler configs. Pointing at unpkg (pinned to
// the exact installed leaflet version) sidesteps that entirely instead of
// depending on this app's specific webpack/Turbopack asset-import setup.
type IconDefaultPrototype = typeof L.Icon.Default.prototype & { _getIconUrl?: unknown }
delete (L.Icon.Default.prototype as IconDefaultPrototype)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

export const INDONESIA_CENTER: [number, number] = [-2.5, 118]
export const INDONESIA_DEFAULT_ZOOM = 5

export interface BaseMapProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: ReactNode
}

export function BaseMap({ center, zoom, className, children }: BaseMapProps) {
  return (
    <MapContainer center={center} zoom={zoom} scrollWheelZoom={false} className={className ?? 'h-64 w-full rounded-md'}>
      <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
      {children}
    </MapContainer>
  )
}

export function MapClickHandler({ onClick }: { onClick: (latitude: number, longitude: number) => void }) {
  useMapEvents({
    click(event) {
      onClick(event.latlng.lat, event.latlng.lng)
    },
  })
  return null
}
