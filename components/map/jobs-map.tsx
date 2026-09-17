'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

export type { JobMapPin } from './jobs-map-impl'

export const JobsMap = dynamic(() => import('./jobs-map-impl').then((mod) => mod.JobsMap), {
  ssr: false,
  loading: () => <Skeleton className="h-96 w-full rounded-md" />,
})
