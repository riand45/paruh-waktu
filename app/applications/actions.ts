'use server'

import { revalidatePath } from 'next/cache'
import { applyToJob, cancelApplication } from '@/lib/services/applications'
import { ApplyToJobSchema, type ApplicationFormState } from '@/lib/validations/application'
import { toSafeErrorMessage } from '@/lib/errors'

export async function applyToJobAction(
  jobId: string,
  _prevState: ApplicationFormState,
  formData: FormData
): Promise<ApplicationFormState> {
  const validatedFields = ApplyToJobSchema.safeParse({
    message: formData.get('message'),
  })

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await applyToJob(jobId, validatedFields.data)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/applications/mine')
  return undefined
}

export async function cancelApplicationAction(applicationId: string, jobId: string): Promise<void> {
  try {
    await cancelApplication(applicationId)
  } catch {
    // Swallow: a race (e.g. the employer reviewed it moments earlier) is
    // resolved by the revalidation below showing the application's actual
    // current status — there's no separate error UI for this simple
    // fire-and-forget cancel button.
  }
  revalidatePath(`/jobs/${jobId}`)
  revalidatePath('/applications/mine')
}
