'use client'

import { useRef, useState, useTransition, type ChangeEvent } from 'react'
import { createClient } from '@/lib/supabase/client'
import { updateAvatarAction } from './actions'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function AvatarUploader({
  userId,
  currentAvatarUrl,
}: {
  userId: string
  currentAvatarUrl: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [avatarUrl, setAvatarUrl] = useState(currentAvatarUrl)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError(null)
    if (inputRef.current) {
      inputRef.current.value = ''
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError('Format file harus JPEG, PNG, atau WebP.')
      return
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError('Ukuran file maksimal 5MB.')
      return
    }

    startTransition(async () => {
      const supabase = createClient()
      const path = `${userId}/${Date.now()}-${file.name}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true })

      if (uploadError) {
        console.error('Avatar upload failed:', uploadError)
        setError('Gagal mengunggah avatar. Silakan coba lagi.')
        return
      }

      const result = await updateAvatarAction(path)
      if (!result.success) {
        setError(result.message)
        return
      }
      setAvatarUrl(result.avatarUrl)
    })
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-16">
        <AvatarImage src={avatarUrl ?? undefined} alt="Avatar" />
        <AvatarFallback>?</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? 'Mengunggah...' : 'Ganti Foto'}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  )
}
