'use server'

import { revalidatePath } from 'next/cache'
import { createJobCategory, updateJobCategory, setJobCategoryActive } from '@/lib/services/job-categories'
import { toSafeErrorMessage } from '@/lib/errors'

export async function createCategoryAction(
  name: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await createJobCategory(name)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/categories')
  return { success: true }
}

export async function updateCategoryAction(
  id: string,
  name: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await updateJobCategory(id, name)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/categories')
  revalidatePath(`/admin/categories/${id}`)
  return { success: true }
}

export async function toggleCategoryActiveAction(
  id: string,
  isActive: boolean
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await setJobCategoryActive(id, isActive)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/categories')
  return { success: true }
}
