'use server'

import { revalidatePath } from 'next/cache'
import { rejectApplication, selectWorker } from '@/lib/services/applications'
import { toSafeErrorMessage } from '@/lib/errors'

export type ApplicantActionState = { success: true } | { success: false; message: string } | undefined

export async function selectWorkerAction(
  jobId: string,
  applicationId: string,
  _prevState: ApplicantActionState,
  _formData: FormData
): Promise<ApplicantActionState> {
  try {
    await selectWorker(jobId, applicationId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/applicants`)
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/jobs')
  revalidatePath('/jobs/mine')
  return { success: true }
}

export async function rejectApplicationAction(
  jobId: string,
  applicationId: string,
  _prevState: ApplicantActionState,
  _formData: FormData
): Promise<ApplicantActionState> {
  try {
    await rejectApplication(applicationId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}/applicants`)
  return { success: true }
}
