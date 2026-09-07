import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/auth/get-current-user', () => ({
  getCurrentUser: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
}))

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createServiceClient } from '@/lib/supabase/service'
import { updateOwnAvatar } from './profiles'

const OWN_USER_ID = 'aaaaaaaa-1111-2222-3333-444444444444'
const OTHER_USER_ID = 'bbbbbbbb-5555-6666-7777-888888888888'
const PUBLIC_URL = 'https://example.supabase.co/storage/v1/object/public/avatars/avatar.png'

function mockServiceClient() {
  return {
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: PUBLIC_URL } }),
      }),
    },
    from: () => ({
      update: () => ({
        eq: () => ({ error: null }),
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
    vi.mocked(createServiceClient).mockReturnValue(mockServiceClient())
  })

  it('accepts a legitimate path in the user\'s own folder', async () => {
    await expect(updateOwnAvatar(`${OWN_USER_ID}/photo.png`)).resolves.toBe(PUBLIC_URL)
  })

  it('rejects a path traversal attempt into another user\'s folder', async () => {
    await expect(
      updateOwnAvatar(`${OWN_USER_ID}/../${OTHER_USER_ID}/x.png`)
    ).rejects.toThrow()
  })

  it('rejects a path directly under a different user\'s folder', async () => {
    await expect(updateOwnAvatar(`${OTHER_USER_ID}/x.png`)).rejects.toThrow()
  })
})
