import 'server-only'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createServiceClient } from '@/lib/supabase/service'
import { appError } from '@/lib/errors'
import { UpdateProfileSchema } from '@/lib/validations/profile'

export interface OwnProfile {
  id: string
  fullName: string
  phone: string | null
  avatarUrl: string | null
  address: string | null
  latitude: number | null
  longitude: number | null
  accountStatus: string
}

export async function getOwnProfile(): Promise<OwnProfile> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('profiles')
    .select(
      'id, full_name, phone, avatar_url, address, latitude, longitude, account_status'
    )
    .eq('id', user.id)
    .single()

  if (error || !data) {
    throw appError('NOT_FOUND', 'Profil tidak ditemukan.')
  }

  return {
    id: data.id,
    fullName: data.full_name,
    phone: data.phone,
    avatarUrl: data.avatar_url,
    address: data.address,
    latitude: data.latitude,
    longitude: data.longitude,
    accountStatus: data.account_status,
  }
}

export interface UpdateProfileInput {
  fullName: string
  phone: string
  address?: string
}

export async function updateOwnProfile(input: UpdateProfileInput): Promise<void> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const validated = UpdateProfileSchema.parse(input)

  const supabase = createServiceClient()
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: validated.fullName,
      phone: validated.phone,
      address: validated.address || null,
    })
    .eq('id', user.id)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }
}

export async function updateOwnAvatar(path: string): Promise<string> {
  const user = await getCurrentUser()
  if (!user) {
    throw appError('UNAUTHENTICATED')
  }

  const ownFolderPattern = new RegExp(`^${user.id}/[A-Za-z0-9._-]+$`)
  if (!ownFolderPattern.test(path)) {
    throw appError('FORBIDDEN', 'Anda hanya dapat mengubah avatar Anda sendiri.')
  }

  const supabase = createServiceClient()
  const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path)
  const avatarUrl = publicUrlData.publicUrl

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: avatarUrl })
    .eq('id', user.id)

  if (error) {
    throw appError('INTERNAL_ERROR')
  }

  return avatarUrl
}
