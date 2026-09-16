import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { updateOwnAvatar } from './profiles'

const OWN_USER_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const PUBLIC_URL = 'https://example.supabase.co/storage/v1/object/public/avatars/avatar.png'

function makeAvatarFile(): File {
  return new File([new Uint8Array(1024)], 'avatar.png', { type: 'image/png' })
}

function mockAuthClient(uploadError: { message: string } | null) {
  return {
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: uploadError }),
      }),
    },
  } as unknown as Awaited<ReturnType<typeof createClient>>
}

function mockServiceClient(updateError: { message: string } | null = null) {
  return {
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: PUBLIC_URL } }),
      }),
    },
    from: () => ({
      update: () => ({
        eq: () => ({ error: updateError }),
      }),
    }),
  } as unknown as ReturnType<typeof createServiceClient>
}

describe('updateOwnAvatar', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: OWN_USER_ID,
      email: 'user@example.com',
      roles: [],
    })
  })

  it("uploads to a path scoped to the authenticated user's own id and returns the public URL", async () => {
    vi.mocked(createClient).mockResolvedValue(mockAuthClient(null))
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient())

    const result = await updateOwnAvatar(makeAvatarFile())

    expect(result).toBe(PUBLIC_URL)
  })

  it('throws when the storage upload fails', async () => {
    vi.mocked(createClient).mockResolvedValue(mockAuthClient({ message: 'boom' }))
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient())

    await expect(updateOwnAvatar(makeAvatarFile())).rejects.toThrow()
  })

  it('throws when the profiles update fails', async () => {
    vi.mocked(createClient).mockResolvedValue(mockAuthClient(null))
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient({ message: 'boom' }))

    await expect(updateOwnAvatar(makeAvatarFile())).rejects.toThrow()
  })

  it('rejects an unauthenticated caller before touching storage', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)

    await expect(updateOwnAvatar(makeAvatarFile())).rejects.toThrow()
  })
})
