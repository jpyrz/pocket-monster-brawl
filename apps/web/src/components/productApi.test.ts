import { afterEach, describe, expect, it, vi } from 'vitest'
import { productApi } from './productApi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('productApi', () => {
  it('returns a JSON response and sends same-origin credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(productApi<{ ok: boolean }>('/api/example')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/example', { credentials: 'same-origin' })
  })

  it('uses a structured server error message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'Username or password is incorrect.' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )))

    await expect(productApi('/api/auth/login')).rejects.toThrow('Username or password is incorrect.')
  })

  it('does not try to parse an empty successful mutation response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))

    await expect(productApi('/api/auth/login', { method: 'POST' })).resolves.toBeUndefined()
  })

  it('reports the status for an empty error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })))

    await expect(productApi('/api/auth/login')).rejects.toThrow('empty response (502)')
  })
})
