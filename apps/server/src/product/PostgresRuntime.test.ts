import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { createDurableProductService } from './DurableProductService.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip
let previousDatabaseUrl: string | undefined

suite('PostgreSQL product runtime', () => {
  beforeAll(() => {
    previousDatabaseUrl = process.env.DATABASE_URL
    process.env.DATABASE_URL = databaseUrl
  })

  afterAll(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  })

  it('retains an authenticated league across connection-pool restarts', async () => {
    const suffix = Date.now().toString(36)
    const firstApp = buildApp({ productService: await createDurableProductService() })
    const signup = await firstApp.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: `pg_${suffix}`, displayName: 'Postgres Red', password: 'pallet-town' },
    })
    const cookie = String(signup.headers['set-cookie']).split(';')[0]
    await firstApp.inject({
      method: 'POST', url: '/api/leagues', headers: { cookie }, payload: { name: 'Postgres Link Club' },
    })
    await firstApp.close()

    const secondApp = buildApp({ productService: await createDurableProductService() })
    const session = await secondApp.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    const leagues = await secondApp.inject({ method: 'GET', url: '/api/leagues', headers: { cookie } })
    expect(session.statusCode).toBe(200)
    expect(leagues.json()).toMatchObject({ leagues: [{ name: 'Postgres Link Club', role: 'owner' }] })
    await secondApp.close()
  }, 20_000)
})
