'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export const MapDisplay = dynamic(() => import('./map-display-impl').then((mod) => mod.MapDisplay), {
  ssr: false,
  loading: () => <Skeleton className="h-48 w-full rounded-md" />,
})
