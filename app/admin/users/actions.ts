'use server'

import { revalidatePath } from 'next/cache'
import { suspendUser, activateUser } from '@/lib/services/admin-users'
import { toSafeErrorMessage } from '@/lib/errors'

export async function suspendUserAction(
  userId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await suspendUser(userId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}

export async function activateUserAction(
  userId: string
): Promise<{ success: true } | { success: false; message: string }> {
  try {
    await activateUser(userId)
  } catch (error) {
    return { success: false, message: toSafeErrorMessage(error) }
  }

  revalidatePath('/admin/users')
  revalidatePath(`/admin/users/${userId}`)
  return { success: true }
}
