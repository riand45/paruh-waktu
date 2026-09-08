import 'server-only'
import { createClient } from '@/lib/supabase/server'

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
