import { useQuery } from '@tanstack/react-query'
import type { AuthSessionView } from '@pmb/domain'

export async function productApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
  })
  const text = await response.text()
  let body: (T & { error?: string }) | undefined

  if (text) {
    try {
      body = JSON.parse(text) as T & { error?: string }
    } catch {
      throw new Error(`The local server returned an unreadable response (${response.status}).`)
    }
  }

  if (!response.ok) {
    throw new Error(body?.error ?? `The local server returned an empty response (${response.status}).`)
  }

  // Some browsers and intermediary caches can surface an otherwise successful
  // mutation as an empty response. Callers that need data will naturally reject
  // it when they use it; auth mutations only need the session cookie.
  return body as T
}

export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: () => productApi<AuthSessionView>('/api/auth/session'),
    retry: false,
  })
}
