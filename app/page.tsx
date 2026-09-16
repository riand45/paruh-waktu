import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export default async function Home() {
  const user = await getCurrentUser()
  redirect(user ? '/jobs' : '/auth/login')
}
