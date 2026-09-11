import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SaveImportView } from '@pmb/domain'
import { buildApp } from '../app.js'
import { importedMankey } from '../registrations/testFixtures.js'
import { createTestDurableProductService } from './PgliteTestProductService.js'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('durable product service', () => {
  it('retains sessions and leagues across a complete API and database restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmb-pglite-'))
    tempDirectories.push(directory)
    const imported: SaveImportView = {
      uploadId: 'd5e24bf3-1270-46e6-8e4e-7d348d158e25', filename: 'Pokemon FireRed.sav',
      sourceDevice: 'Analogue Pocket', profileId: 'firered-gen3-v1', importedAt: '2026-09-11T12:00:00.000Z',
      parserVersion: 'test-parser', sha256: 'restart-hash', size: 131_072, game: 'Pokemon FireRed', gameVersion: 'FR',
      language: 'English', checksumsValid: true, trainer: { name: 'RED', tid: 1, sid: 2, playTime: '10:00:00' },
      pokemon: [importedMankey], warnings: [], rawSaveStored: false,
    }

    const firstService = await createTestDurableProductService(directory)
    const firstApp = buildApp({ productService: firstService, importSave: async () => imported })
    const signup = await firstApp.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'restart_red', displayName: 'Restart Red', password: 'pallet-town' },
    })
    expect(signup.statusCode).toBe(200)
    const cookie = String(signup.headers['set-cookie']).split(';')[0]
    const rivalSignup = await firstApp.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'restart_blue', displayName: 'Restart Blue', password: 'viridian-city' },
    })
    const rivalCookie = String(rivalSignup.headers['set-cookie']).split(';')[0]
    const created = await firstApp.inject({
      method: 'POST', url: '/api/leagues', headers: { cookie }, payload: { name: 'Durable Link Club' },
    })
    expect(created.statusCode).toBe(200)
    const leagueId = created.json<{ id: string }>().id
    const search = await firstApp.inject({ method: 'GET', url: '/api/users/search?q=restart_blue', headers: { cookie } })
    const rivalId = search.json<{ users: { id: string }[] }>().users[0]!.id
    await firstApp.inject({
      method: 'POST', url: `/api/leagues/${leagueId}/invitations`, headers: { cookie }, payload: { userId: rivalId },
    })
    const inbox = await firstApp.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: rivalCookie } })
    const invitationId = inbox.json<{ invitations: { id: string }[] }>().invitations[0]!.id
    expect((await firstApp.inject({ method: 'POST', url: `/api/invitations/${invitationId}/accept`, headers: { cookie: rivalCookie } })).statusCode).toBe(200)
    const tournament = await firstApp.inject({
      method: 'POST', url: `/api/leagues/${leagueId}/tournaments`, headers: { cookie },
      payload: { name: 'Restart Cup', bestOf: 3, teamSize: 6 },
    })
    expect(tournament.statusCode).toBe(200)
    const tournamentId = tournament.json<{ id: string }>().id
    const upload = await firstApp.inject({
      method: 'POST', url: '/api/save-imports/fire-red',
      headers: { cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav', 'x-tournament-id': tournamentId },
      payload: Buffer.alloc(131_072),
    })
    expect(upload.statusCode).toBe(200)
    const draft = await firstApp.inject({
      method: 'POST', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie },
      payload: { uploadId: imported.uploadId, pokemonFingerprints: [importedMankey.fingerprint] },
    })
    expect(draft.statusCode).toBe(200)
    await firstApp.close()

    const secondService = await createTestDurableProductService(directory)
    const secondApp = buildApp({ productService: secondService })
    const session = await secondApp.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    const leagues = await secondApp.inject({ method: 'GET', url: '/api/leagues', headers: { cookie } })
    const rivalLeagues = await secondApp.inject({ method: 'GET', url: '/api/leagues', headers: { cookie: rivalCookie } })
    const restoredDraft = await secondApp.inject({ method: 'GET', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie } })

    expect(session.json()).toMatchObject({ user: { username: 'restart_red' } })
    expect(leagues.json()).toMatchObject({ leagues: [{ name: 'Durable Link Club', role: 'owner', nextTournament: { name: 'Restart Cup' } }] })
    expect(rivalLeagues.json()).toMatchObject({ leagues: [{ name: 'Durable Link Club', role: 'player', memberCount: 2 }] })
    expect(restoredDraft.json()).toMatchObject({
      draft: { status: 'draft', pokemon: [{ species: 'Mankey' }] },
      saveImport: { uploadId: imported.uploadId, rawSaveStored: false },
    })
    await secondApp.close()
  }, 20_000)
})
