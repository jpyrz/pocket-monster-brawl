import { useQuery } from '@tanstack/react-query'
import type { AuthSessionView } from '@pmb/domain'

export async function productApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? 'Something went wrong.')
  return body
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => productApi<AuthSessionView>('/api/auth/session'),
    retry: false,
  })
}
