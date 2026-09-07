import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { hasRole, type AppRole } from './has-role'

export interface CurrentUser {
  id: string
  email: string | null
  roles: AppRole[]
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (!claims) return null

  const { data: roleRows, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', claims.sub)

  if (error) {
    throw new Error('Failed to load roles for the current user.')
  }

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    roles: (roleRows ?? []).map((r) => r.role as AppRole),
  }
})

export async function requireRole(role: AppRole): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error('UNAUTHENTICATED')
  }
  if (!hasRole(user.roles.map((r) => ({ role: r })), role)) {
    throw new Error('FORBIDDEN')
  }
  return user
}
