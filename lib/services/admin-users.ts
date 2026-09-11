import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import type { AppRole } from '@/lib/auth/has-role'

export interface AdminUserSummary {
  id: string
  fullName: string
  email: string | null
  accountStatus: string
  roles: AppRole[]
  createdAt: string
}

export interface AdminUserFilters {
  search?: string
  role?: AppRole
  status?: 'active' | 'suspended'
}

export async function getUsersForAdmin(filters: AdminUserFilters = {}): Promise<AdminUserSummary[]> {
  await requireRole('admin')
  const supabase = createServiceClient()

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name, account_status, created_at')
    .order('created_at', { ascending: false })

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: roleRows, error: rolesError } = await supabase.from('user_roles').select('user_id, role')

  if (rolesError) {
    throw appError('INTERNAL_ERROR')
  }

  const rolesById = new Map<string, AppRole[]>()
  for (const row of roleRows ?? []) {
    const roles = rolesById.get(row.user_id) ?? []
    roles.push(row.role as AppRole)
    rolesById.set(row.user_id, roles)
  }

  const {
    data: { users: authUsers },
    error: authError,
  } = await supabase.auth.admin.listUsers({ perPage: 1000 })

  if (authError) {
    throw appError('INTERNAL_ERROR')
  }

  const emailById = new Map(authUsers.map((authUser) => [authUser.id, authUser.email ?? null]))

  let rows: AdminUserSummary[] = (profiles ?? []).map((profile) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: emailById.get(profile.id) ?? null,
    accountStatus: profile.account_status,
    roles: rolesById.get(profile.id) ?? [],
    createdAt: profile.created_at,
  }))

  if (filters.status) {
    rows = rows.filter((row) => row.accountStatus === filters.status)
  }
  if (filters.role) {
    const role = filters.role
    rows = rows.filter((row) => row.roles.includes(role))
  }
  if (filters.search) {
    const term = filters.search.toLowerCase()
    rows = rows.filter(
      (row) => row.fullName.toLowerCase().includes(term) || (row.email ?? '').toLowerCase().includes(term)
    )
  }

  return rows
}

export interface AdminUserDetail extends AdminUserSummary {
  latestVerificationId: string | null
}

export async function getUserDetailForAdmin(userId: string): Promise<AdminUserDetail | null> {
  await requireRole('admin')
  const supabase = createServiceClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, account_status, created_at')
    .eq('id', userId)
    .maybeSingle()

  if (error || !profile) {
    return null
  }

  const { data: roleRows, error: rolesError } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)

  if (rolesError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId)
  if (authError) {
    throw appError('INTERNAL_ERROR')
  }

  const { data: verification, error: verificationError } = await supabase
    .from('employer_verifications')
    .select('id')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (verificationError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: authUser.user?.email ?? null,
    accountStatus: profile.account_status,
    roles: (roleRows ?? []).map((row) => row.role as AppRole),
    createdAt: profile.created_at,
    latestVerificationId: verification?.id ?? null,
  }
}

function mapSuspendUserError(message: string): Error {
  if (message.includes('cannot suspend own account')) {
    return appError('FORBIDDEN', 'Anda tidak dapat menangguhkan akun Anda sendiri.')
  }
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  return appError('INTERNAL_ERROR')
}

export async function suspendUser(userId: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('suspend_user', { p_user_id: userId })

  if (error) {
    throw mapSuspendUserError(error.message)
  }
}

function mapActivateUserError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  return appError('INTERNAL_ERROR')
}

export async function activateUser(userId: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('activate_user', { p_user_id: userId })

  if (error) {
    throw mapActivateUserError(error.message)
  }
}
