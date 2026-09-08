'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError, toSafeErrorMessage, type ErrorCode } from '@/lib/errors'

function mapReviewError(message: string): { code: ErrorCode; message?: string } {
  if (message.includes('FORBIDDEN')) return { code: 'FORBIDDEN' }
  if (message.includes('CONFLICT')) {
    return { code: 'CONFLICT', message: 'Pengajuan ini sudah ditinjau sebelumnya.' }
  }
  if (message.includes('NOT_FOUND')) return { code: 'NOT_FOUND' }
  if (message.includes('rejection_reason required')) {
    return { code: 'VALIDATION_ERROR', message: 'Alasan penolakan wajib diisi.' }
  }
  if (message.includes('VALIDATION_ERROR')) return { code: 'VALIDATION_ERROR' }
  return { code: 'INTERNAL_ERROR' }
}

export async function reviewEmployerVerificationAction(
  verificationId: string,
  decision: 'approved' | 'rejected',
  rejectionReason?: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await requireRole('admin')

    const supabase = await createClient()
    const { error } = await supabase.rpc('review_employer_verification', {
      p_verification_id: verificationId,
      p_decision: decision,
      p_rejection_reason: rejectionReason,
    })

    if (error) {
      const mapped = mapReviewError(error.message)
      throw appError(mapped.code, mapped.message)
    }
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/employer-verifications')
  revalidatePath(`/admin/employer-verifications/${verificationId}`)
  return { success: true }
}
