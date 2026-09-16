'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createJob, updateJob } from '@/lib/services/jobs'
import { CreateJobSchema, type JobFormState } from '@/lib/validations/job'
import { toSafeErrorMessage } from '@/lib/errors'

function parseJobFormData(formData: FormData) {
  return {
    title: formData.get('title'),
    categoryId: formData.get('categoryId'),
    description: formData.get('description'),
    address: formData.get('address'),
    latitude: formData.get('latitude'),
    longitude: formData.get('longitude'),
    paymentAmount: formData.get('paymentAmount'),
    durationMinutes: formData.get('durationMinutes'),
    deadline: formData.get('deadline'),
  }
}

export async function createJobAction(
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  const validatedFields = CreateJobSchema.safeParse(parseJobFormData(formData))

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  let jobId: string
  try {
    const result = await createJob(validatedFields.data)
    jobId = result.id
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/jobs')
  revalidatePath('/jobs/mine')
  redirect(`/jobs/${jobId}`)
}

export async function updateJobAction(
  jobId: string,
  _prevState: JobFormState,
  formData: FormData
): Promise<JobFormState> {
  const validatedFields = CreateJobSchema.safeParse(parseJobFormData(formData))

  if (!validatedFields.success) {
    return { errors: validatedFields.error.flatten().fieldErrors }
  }

  try {
    await updateJob(jobId, validatedFields.data)
  } catch (error) {
    return { message: toSafeErrorMessage(error) }
  }

  revalidatePath('/jobs')
  revalidatePath('/jobs/mine')
  revalidatePath(`/jobs/${jobId}`)
  redirect(`/jobs/${jobId}`)
}
