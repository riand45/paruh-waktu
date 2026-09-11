import 'server-only'
import { requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface AdminDashboardStats {
  totalUsers: number
  totalWorkers: number
  totalEmployers: number
  activeJobs: number
  completedJobs: number
  pendingPayments: number
  pendingWithdrawals: number
}

const ACTIVE_JOB_STATUSES = [
  'open',
  'assigned',
  'waiting_payment',
  'payment_review',
  'payment_verified',
  'in_progress',
  'waiting_confirmation',
]

export async function getAdminDashboardStats(): Promise<AdminDashboardStats> {
  await requireRole('admin')
  const supabase = await createClient()

  const [totalUsers, totalWorkers, totalEmployers, activeJobs, completedJobs, pendingPayments, pendingWithdrawals] =
    await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'worker'),
      supabase.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'employer'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).in('status', ACTIVE_JOB_STATUSES),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'waiting_verification'),
      supabase.from('withdrawals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ])

  const results = [totalUsers, totalWorkers, totalEmployers, activeJobs, completedJobs, pendingPayments, pendingWithdrawals]
  if (results.some((result) => result.error)) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    totalUsers: totalUsers.count ?? 0,
    totalWorkers: totalWorkers.count ?? 0,
    totalEmployers: totalEmployers.count ?? 0,
    activeJobs: activeJobs.count ?? 0,
    completedJobs: completedJobs.count ?? 0,
    pendingPayments: pendingPayments.count ?? 0,
    pendingWithdrawals: pendingWithdrawals.count ?? 0,
  }
}
