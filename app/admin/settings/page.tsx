import { requireAdminOr404 } from '@/lib/auth/get-current-user'
import { getAllPlatformSettings } from '@/lib/services/admin-settings'
import { SettingsForm } from './settings-form'

export default async function AdminSettingsPage() {
  await requireAdminOr404()
  const initial = await getAllPlatformSettings()

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <h1 className="text-xl font-semibold">Pengaturan Platform</h1>
      <SettingsForm initial={initial} />
    </div>
  )
}
