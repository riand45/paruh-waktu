import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/get-current-user'
import { appError } from '@/lib/errors'

export interface JobCategoryOption {
  id: string
  name: string
}

export async function getActiveJobCategories(): Promise<{
  categories: JobCategoryOption[]
  error: boolean
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('job_categories')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  return { categories: data ?? [], error: Boolean(error) }
}

export interface AdminJobCategory {
  id: string
  name: string
  isActive: boolean
}

export async function getAllJobCategoriesForAdmin(): Promise<AdminJobCategory[]> {
  await requireRole('admin')
  const supabase = await createClient()
  const { data, error } = await supabase.from('job_categories').select('id, name, is_active').order('name')

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, isActive: row.is_active }))
}

function mapCategoryError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Nama kategori sudah digunakan.')
  }
  return appError('INTERNAL_ERROR')
}

export async function createJobCategory(name: string): Promise<{ id: string }> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('create_job_category', { p_name: name })

  if (error) {
    throw mapCategoryError(error.message)
  }

  return { id: data as string }
}

export async function updateJobCategory(id: string, name: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('update_job_category', { p_id: id, p_name: name })

  if (error) {
    throw mapCategoryError(error.message)
  }
}

export async function setJobCategoryActive(id: string, isActive: boolean): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('set_job_category_active', { p_id: id, p_is_active: isActive })

  if (error) {
    throw mapCategoryError(error.message)
  }
}
