import 'server-only'
import { getCurrentUser, requireRole } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface Withdrawal {
  id: string
  amount: number
  bankName: string
  accountNumber: string
  accountHolderName: string
  status: string
  transferProofPath: string | null
  rejectionReason: string | null
  createdAt: string
}

interface WithdrawalRow {
  id: string
  amount: number
  bank_name: string
  account_number: string
  account_holder_name: string
  status: string
  transfer_proof_path: string | null
  rejection_reason: string | null
  created_at: string
}

function mapWithdrawalRow(row: WithdrawalRow): Withdrawal {
  return {
    id: row.id,
    amount: row.amount,
    bankName: row.bank_name,
    accountNumber: row.account_number,
    accountHolderName: row.account_holder_name,
    status: row.status,
    transferProofPath: row.transfer_proof_path,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
  }
}

function mapRequestWithdrawalError(message: string): Error {
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Anda masih memiliki permintaan withdrawal yang sedang diproses.')
  }
  if (message.includes('insufficient balance') || message.includes('amount exceeds')) {
    return appError('VALIDATION_ERROR', 'Jumlah withdrawal melebihi saldo yang tersedia.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR', 'Data bank tidak valid.')
  }
  return appError('INTERNAL_ERROR')
}

export async function requestWithdrawal(
  amount: number,
  bankName: string,
  accountNumber: string,
  accountHolderName: string
): Promise<{ id: string }> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_withdrawal', {
    p_amount: amount,
    p_bank_name: bankName,
    p_account_number: accountNumber,
    p_account_holder_name: accountHolderName,
  })

  if (error) {
    throw mapRequestWithdrawalError(error.message)
  }

  return { id: data as string }
}

export async function getWithdrawalsForCurrentUser(): Promise<Withdrawal[]> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('withdrawals')
    .select(
      'id, amount, bank_name, account_number, account_holder_name, status, transfer_proof_path, rejection_reason, created_at'
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return (data ?? []).map(mapWithdrawalRow)
}

export interface AdminWithdrawalSummary {
  id: string
  userId: string
  userName: string
  amount: number
  status: string
  createdAt: string
}

export async function getWithdrawalsForAdmin(): Promise<AdminWithdrawalSummary[]> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: withdrawals, error } = await supabase
    .from('withdrawals')
    .select('id, user_id, amount, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  const rows = withdrawals ?? []
  const statusOrder: Record<string, number> = {
    pending: 0,
    processing: 1,
    rejected: 2,
    paid: 3,
  }
  rows.sort((a, b) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4))

  if (rows.length === 0) {
    return []
  }

  const userIds = rows.map((row) => row.user_id)
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds)

  if (profilesError) {
    throw appError('INTERNAL_ERROR')
  }

  const nameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name]))

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: nameById.get(row.user_id) ?? 'Tidak diketahui',
    amount: row.amount,
    status: row.status,
    createdAt: row.created_at,
  }))
}

export interface AdminWithdrawalDetail extends Withdrawal {
  userId: string
  userName: string
}

export async function getWithdrawalDetailForAdmin(
  withdrawalId: string
): Promise<AdminWithdrawalDetail | null> {
  await requireRole('admin')
  const supabase = await createClient()

  const { data: withdrawal, error } = await supabase
    .from('withdrawals')
    .select(
      'id, user_id, amount, bank_name, account_number, account_holder_name, status, transfer_proof_path, rejection_reason, created_at'
    )
    .eq('id', withdrawalId)
    .maybeSingle()

  if (error || !withdrawal) {
    return null
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', withdrawal.user_id)
    .maybeSingle()

  if (profileError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    ...mapWithdrawalRow(withdrawal),
    userId: withdrawal.user_id,
    userName: profile?.full_name ?? 'Tidak diketahui',
  }
}

function mapProcessWithdrawalError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Withdrawal ini sudah diproses sebelumnya.')
  }
  return appError('INTERNAL_ERROR')
}

export async function processWithdrawal(withdrawalId: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('process_withdrawal', { p_withdrawal_id: withdrawalId })

  if (error) {
    throw mapProcessWithdrawalError(error.message)
  }
}

function mapRejectWithdrawalError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('rejection_reason required')) {
    return appError('VALIDATION_ERROR', 'Alasan penolakan wajib diisi.')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Withdrawal ini sudah tidak dapat ditolak.')
  }
  return appError('INTERNAL_ERROR')
}

export async function rejectWithdrawal(withdrawalId: string, rejectionReason: string): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('reject_withdrawal', {
    p_withdrawal_id: withdrawalId,
    p_rejection_reason: rejectionReason,
  })

  if (error) {
    throw mapRejectWithdrawalError(error.message)
  }
}

function mapMarkWithdrawalPaidError(message: string): Error {
  if (message.includes('FORBIDDEN')) {
    return appError('FORBIDDEN')
  }
  if (message.includes('NOT_FOUND')) {
    return appError('NOT_FOUND')
  }
  if (message.includes('CONFLICT')) {
    return appError('CONFLICT', 'Withdrawal ini belum siap untuk ditandai lunas.')
  }
  if (message.includes('VALIDATION_ERROR')) {
    return appError('VALIDATION_ERROR')
  }
  return appError('INTERNAL_ERROR')
}

export async function markWithdrawalPaid(withdrawalId: string, file: File): Promise<void> {
  await requireRole('admin')
  const supabase = await createClient()
  const path = `${withdrawalId}/${Date.now()}-${file.name}`

  const { error: uploadError } = await supabase.storage
    .from('withdrawal-proofs')
    .upload(path, file, { contentType: file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah bukti transfer.')
  }

  const { error } = await supabase.rpc('mark_withdrawal_paid', {
    p_withdrawal_id: withdrawalId,
    p_transfer_proof_path: path,
  })

  if (error) {
    await supabase.storage.from('withdrawal-proofs').remove([path])
    throw mapMarkWithdrawalPaidError(error.message)
  }
}
