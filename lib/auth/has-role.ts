export type AppRole = 'worker' | 'employer' | 'admin'

export function hasRole(
  roles: { role: AppRole }[],
  role: AppRole
): boolean {
  return roles.some((r) => r.role === role)
}
