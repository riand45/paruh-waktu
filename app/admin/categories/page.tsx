import Link from 'next/link'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAllJobCategoriesForAdmin } from '@/lib/services/job-categories'
import { ToggleActiveButton } from './toggle-active-button'

export default async function AdminCategoriesPage() {
  await requireAdminOr404()
  const categories = await getAllJobCategoriesForAdmin()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Kategori Pekerjaan</h1>
        <Link href="/admin/categories/new" className="text-sm text-primary underline-offset-4 hover:underline">
          Tambah Kategori
        </Link>
      </div>
      {categories.length === 0 && <p className="text-sm text-muted-foreground">Belum ada kategori.</p>}
      <ul className="flex flex-col gap-2">
        {categories.map((category) => (
          <li key={category.id} className="flex items-center justify-between rounded border p-3 text-sm">
            <div className="flex flex-col">
              <span className="font-medium">{category.name}</span>
              <span className="text-muted-foreground">{category.isActive ? 'Aktif' : 'Nonaktif'}</span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/admin/categories/${category.id}`}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Edit
              </Link>
              <ToggleActiveButton categoryId={category.id} isActive={category.isActive} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
