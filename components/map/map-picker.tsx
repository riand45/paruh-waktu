'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export type { MapPickerValue } from './map-picker-impl'

export const MapPicker = dynamic(() => import('./map-picker-impl').then((mod) => mod.MapPicker), {
  ssr: false,
  loading: () => <Skeleton className="h-64 w-full rounded-md" />,
})
