'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createCategoryAction, updateCategoryAction } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function CategoryForm({ categoryId, initialName }: { categoryId?: string; initialName?: string }) {
  const [name, setName] = useState(initialName ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit() {
    setError(null)
    if (name.trim().length === 0) {
      setError('Nama kategori wajib diisi.')
      return
    }

    startTransition(async () => {
      const result = categoryId ? await updateCategoryAction(categoryId, name) : await createCategoryAction(name)
      if (!result.success) {
        setError(result.message)
        return
      }
      router.push('/admin/categories')
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Nama Kategori</Label>
        <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" disabled={isPending} onClick={handleSubmit}>
        {isPending ? 'Menyimpan...' : categoryId ? 'Simpan Perubahan' : 'Tambah Kategori'}
      </Button>
    </div>
  )
}
