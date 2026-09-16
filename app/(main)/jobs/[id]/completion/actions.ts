'use server'

import { revalidatePath } from 'next/cache'
import {
  recordJobEvidence,
  submitJobCompletion,
  confirmJobCompletion,
} from '@/lib/services/completions'
import { toSafeErrorMessage } from '@/lib/errors'
import { getEffectiveUploadLimits, validateUploadedFile } from '@/lib/upload-limits'

export type EvidenceUploadFormState =
  | {
      errors?: {
        file?: string[]
      }
      message?: string
    }
  | undefined

export async function recordJobEvidenceAction(
  jobId: string,
  _prevState: EvidenceUploadFormState,
  formData: FormData
): Promise<EvidenceUploadFormState> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { errors: { file: ['Bukti pekerjaan wajib diunggah.'] } }
  }
  const limits = await getEffectiveUploadLimits('jobEvidence')
  const validationError = validateUploadedFile(file, limits)
  if (validationError) {
    return { errors: { file: [validationError] } }
  }

  try {
    await recordJobEvidence(jobId, file)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/completion`)
  return undefined
}

export async function submitJobCompletionAction(
  jobId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await submitJobCompletion(jobId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/completion`)
  revalidatePath(`/jobs/${jobId}`)
  return { success: true }
}

export async function confirmJobCompletionAction(
  jobId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await confirmJobCompletion(jobId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/completion`)
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/wallet')
  return { success: true }
}
