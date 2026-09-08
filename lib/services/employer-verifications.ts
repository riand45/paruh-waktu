import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { appError } from '@/lib/errors'
import { SubmitEmployerVerificationSchema } from '@/lib/validations/employer-verification'

export interface EmployerVerificationStatus {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason: string | null
  submittedAt: string
}

export async function getLatestEmployerVerification(): Promise<EmployerVerificationStatus | null> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employer_verifications')
    .select('id, status, rejection_reason, submitted_at')
    .eq('user_id', user.id)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
  if (!data) {
    return null
  }

  return {
    id: data.id,
    status: data.status as EmployerVerificationStatus['status'],
    rejectionReason: data.rejection_reason,
    submittedAt: data.submitted_at,
  }
}

export interface SubmitEmployerVerificationInput {
  fullNameOnKtp: string
  ktpNumber: string
  file: File
}

export async function submitEmployerVerification(
  input: SubmitEmployerVerificationInput
): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const validated = SubmitEmployerVerificationSchema.parse({
    fullNameOnKtp: input.fullNameOnKtp,
    ktpNumber: input.ktpNumber,
  })

  const supabase = await createClient()
  const path = `${user.id}/${Date.now()}-${input.file.name}`

  const { error: uploadError } = await supabase.storage
    .from('kyc-documents')
    .upload(path, input.file, { contentType: input.file.type })

  if (uploadError) {
    throw appError('INTERNAL_ERROR', 'Gagal mengunggah dokumen KTP.')
  }

  const { error: insertError } = await supabase.from('employer_verifications').insert({
    user_id: user.id,
    full_name_on_ktp: validated.fullNameOnKtp,
    ktp_number: validated.ktpNumber,
    ktp_document_path: path,
  })

  if (insertError) {
    if (insertError.code === '23505') {
      throw appError(
        'CONFLICT',
        'Anda masih memiliki pengajuan yang menunggu peninjauan.'
      )
    }
    throw appError('INTERNAL_ERROR')
  }
}
