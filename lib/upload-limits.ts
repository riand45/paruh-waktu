import 'server-only'
import { getUploadSettings } from '@/lib/services/admin-settings'

export type UploadContext =
  | 'avatar'
  | 'ktp'
  | 'paymentProof'
  | 'jobEvidence'
  | 'withdrawalProof'
  | 'refundProof'

export interface UploadCeiling {
  maxSizeBytes: number
  allowedTypes: string[]
}

export const UPLOAD_CEILINGS: Record<UploadContext, UploadCeiling> = {
  avatar: { maxSizeBytes: 5 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'image/webp'] },
  ktp: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
  paymentProof: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
  jobEvidence: {
    maxSizeBytes: 20 * 1024 * 1024,
    allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'],
  },
  withdrawalProof: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
  refundProof: { maxSizeBytes: 10 * 1024 * 1024, allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'] },
}

const TYPE_LABELS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'video/mp4': 'MP4',
  'application/pdf': 'PDF',
}

export function computeEffectiveLimits(
  ceiling: UploadCeiling,
  platformMaxSizeMb: number,
  platformAllowedTypes: string[]
): UploadCeiling {
  return {
    maxSizeBytes: Math.min(ceiling.maxSizeBytes, platformMaxSizeMb * 1024 * 1024),
    allowedTypes: ceiling.allowedTypes.filter((type) => platformAllowedTypes.includes(type)),
  }
}

export function validateUploadedFile(file: File, limits: UploadCeiling): string | null {
  if (!limits.allowedTypes.includes(file.type)) {
    const typeList = limits.allowedTypes.map((type) => TYPE_LABELS[type] ?? type).join(', ')
    return typeList
      ? `Format file harus ${typeList}.`
      : 'Tidak ada format file yang diizinkan Admin untuk unggahan ini.'
  }
  if (file.size > limits.maxSizeBytes) {
    const maxMb = Math.floor(limits.maxSizeBytes / (1024 * 1024))
    return `Ukuran file maksimal ${maxMb}MB.`
  }
  return null
}

export async function getEffectiveUploadLimits(context: UploadContext): Promise<UploadCeiling> {
  const settings = await getUploadSettings()
  return computeEffectiveLimits(UPLOAD_CEILINGS[context], settings.maxUploadSizeMb, settings.allowedFileTypes)
}
