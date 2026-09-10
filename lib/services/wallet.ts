import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'

export interface WalletTransaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  relatedJobId: string | null
  description: string | null
  createdAt: string
}

export interface WalletSummary {
  balance: number
  transactions: WalletTransaction[]
}

interface WalletTransactionRow {
  id: string
  type: string
  amount: number
  balance_after: number
  related_job_id: string | null
  description: string | null
  created_at: string
}

function mapWalletTransactionRow(row: WalletTransactionRow): WalletTransaction {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount,
    balanceAfter: row.balance_after,
    relatedJobId: row.related_job_id,
    description: row.description,
    createdAt: row.created_at,
  }
}

export async function getWalletForCurrentUser(): Promise<WalletSummary> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data: wallet, error: walletError } = await supabase
    .from('wallets')
    .select('id, balance')
    .eq('user_id', user.id)
    .maybeSingle()

  if (walletError) {
    throw appError('INTERNAL_ERROR')
  }

  if (!wallet) {
    return { balance: 0, transactions: [] }
  }

  const { data: transactions, error: transactionsError } = await supabase
    .from('wallet_transactions')
    .select('id, type, amount, balance_after, related_job_id, description, created_at')
    .eq('wallet_id', wallet.id)
    .order('created_at', { ascending: false })

  if (transactionsError) {
    throw appError('INTERNAL_ERROR')
  }

  return {
    balance: wallet.balance,
    transactions: (transactions ?? []).map(mapWalletTransactionRow),
  }
}
