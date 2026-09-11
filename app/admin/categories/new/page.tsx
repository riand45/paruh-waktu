import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { CategoryForm } from '../category-form'

export default async function NewCategoryPage() {
  await requireAdminOr404()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Tambah Kategori</h1>
      <CategoryForm />
    </div>
  )
}
