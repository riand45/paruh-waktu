import { notFound } from 'next/navigation'
import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAllJobCategoriesForAdmin } from '@/lib/services/job-categories'
import { CategoryForm } from '../category-form'

export default async function EditCategoryPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdminOr404()
  const { id } = await params

  const categories = await getAllJobCategoriesForAdmin()
  const category = categories.find((c) => c.id === id)
  if (!category) {
    notFound()
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Edit Kategori</h1>
      <CategoryForm categoryId={category.id} initialName={category.name} />
    </div>
  )
}
