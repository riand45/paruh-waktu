import 'server-only'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasRole, type AppRole } from './has-role'
import { appError } from '@/lib/errors'

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
    throw appError('UNAUTHENTICATED')
  }
  if (!hasRole(user.roles.map((r) => ({ role: r })), role)) {
    throw appError('FORBIDDEN')
  }
  return user
}

// Defense-in-depth for Next.js soft navigation between sibling routes under
// the same layout, which does not re-run the layout's own requireRole guard.
// Pages under /admin call this directly so a mid-session role change (e.g. a
// demoted admin) still results in a 404 instead of an uncaught AppError.
export async function requireAdminOr404(): Promise<void> {
  try {
    await requireRole('admin')
  } catch {
    notFound()
  }
}
