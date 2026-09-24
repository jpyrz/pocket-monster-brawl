import { afterEach, describe, expect, it } from 'vitest'
import type { DemoBattleView, SaveImportView } from '@pmb/domain'
import { buildApp } from './app.js'
import { importedMankey } from './registrations/testFixtures.js'

const apps: ReturnType<typeof buildApp>[] = []

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('application API', () => {
  it('supports the account-to-league-to-tournament invitation journey with private membership checks', async () => {
    const app = buildApp()
    apps.push(app)

    const ownerSignup = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'misty', displayName: 'Misty', password: 'cerulean-gym' },
    })
    const ownerCookie = String(ownerSignup.headers['set-cookie']).split(';')[0]
    const leagueResponse = await app.inject({
      method: 'POST', url: '/api/leagues', headers: { cookie: ownerCookie }, payload: { name: 'Kanto Link Club' },
    })
    const league = leagueResponse.json<{ id: string }>()

    const playerSignup = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'brock', displayName: 'Brock', password: 'pewter-gym' },
    })
    const playerCookie = String(playerSignup.headers['set-cookie']).split(';')[0]
    const privateBeforeInvite = await app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, headers: { cookie: playerCookie } })
    expect(privateBeforeInvite.statusCode).toBe(404)

    const search = await app.inject({ method: 'GET', url: '/api/users/search?q=bro', headers: { cookie: ownerCookie } })
    const target = search.json<{ users: { id: string }[] }>().users[0]
    const invitation = await app.inject({
      method: 'POST', url: `/api/leagues/${league.id}/invitations`, headers: { cookie: ownerCookie }, payload: { userId: target?.id },
    })
    expect(invitation.statusCode).toBe(200)

    const inbox = await app.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: playerCookie } })
    const inviteId = inbox.json<{ invitations: { id: string }[] }>().invitations[0]?.id
    await app.inject({ method: 'POST', url: `/api/invitations/${inviteId}/accept`, headers: { cookie: playerCookie } })

    const tournament = await app.inject({
      method: 'POST', url: `/api/leagues/${league.id}/tournaments`, headers: { cookie: ownerCookie },
      payload: { name: 'Indigo Cup', bestOf: 3, teamSize: 6 },
    })
    expect(tournament.json()).toMatchObject({
      name: 'Indigo Cup', status: 'registration-open',
      rules: { bestOf: 3, teamSize: 6, bracket: 'single-elimination', teamPreview: false },
    })

    const playerCannotAdmin = await app.inject({
      method: 'POST', url: `/api/leagues/${league.id}/tournaments`, headers: { cookie: playerCookie },
      payload: { name: 'Secret Cup' },
    })
    expect(playerCannotAdmin.statusCode).toBe(403)
    const memberView = await app.inject({ method: 'GET', url: `/api/leagues/${league.id}`, headers: { cookie: playerCookie } })
    expect(memberView.json()).toMatchObject({ members: [{ teamStatus: 'not-started' }, { teamStatus: 'not-started' }] })
    expect(JSON.stringify(memberView.json())).not.toContain('pokemon')
  })

  it('restores a private tournament team draft without re-uploading the save', async () => {
    const imported: SaveImportView = {
      uploadId: 'draft-import', filename: 'Pokemon FireRed.sav', sourceDevice: 'Analogue Pocket',
      profileId: 'firered-gen3-v1', importedAt: '2026-09-11T12:00:00.000Z', parserVersion: 'test-parser',
      sha256: 'draft-hash', size: 131_072, game: 'Pokemon FireRed', gameVersion: 'FR', language: 'English',
      checksumsValid: true, trainer: { name: 'RED', tid: 1, sid: 2, playTime: '10:00:00' },
      pokemon: [importedMankey], warnings: [], rawSaveStored: false,
    }
    const app = buildApp({ importSave: async () => imported })
    apps.push(app)
    const signup = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'leaf', displayName: 'Leaf', password: 'pallet-town' },
    })
    const cookie = String(signup.headers['set-cookie']).split(';')[0]
    const league = await app.inject({ method: 'POST', url: '/api/leagues', headers: { cookie }, payload: { name: 'Link Club' } })
    const tournament = await app.inject({
      method: 'POST', url: `/api/leagues/${league.json<{ id: string }>().id}/tournaments`, headers: { cookie },
      payload: { name: 'Indigo Cup' },
    })
    const tournamentId = tournament.json<{ id: string }>().id
    await app.inject({
      method: 'POST', url: '/api/save-imports/fire-red',
      headers: { cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav', 'x-tournament-id': tournamentId },
      payload: Buffer.alloc(131_072),
    })
    const recoveredImport = await app.inject({
      method: 'GET', url: `/api/tournaments/${tournamentId}/save-imports/${imported.uploadId}`, headers: { cookie },
    })
    expect(recoveredImport.statusCode).toBe(200)
    expect(recoveredImport.json()).toMatchObject({ uploadId: imported.uploadId, trainer: { name: 'RED' } })
    const saved = await app.inject({
      method: 'POST', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie },
      payload: { uploadId: imported.uploadId, pokemonFingerprints: [importedMankey.fingerprint] },
    })
    expect(saved.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/team-registrations/current' })).statusCode).toBe(404)

    const restored = await app.inject({ method: 'GET', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie } })
    expect(restored.json()).toMatchObject({
      draft: { status: 'draft', pokemon: [{ species: 'Mankey' }] },
      saveImport: { uploadId: 'draft-import', trainer: { name: 'RED' }, rawSaveStored: false },
    })
  })

  it('reports its health without requiring the database', async () => {
    const app = buildApp()
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ status: 'ok' })
  })

  it('publishes only enabled player profiles', async () => {
    const app = buildApp()
    apps.push(app)
    const response = await app.inject({ method: 'GET', url: '/api/profiles' })

    expect(response.json().profiles).toHaveLength(1)
    expect(response.json().profiles[0].id).toBe('firered-gen3-v1')
  })

  it('validates and forwards a raw FireRed .srm save without storing it', async () => {
    const imported: SaveImportView = {
      uploadId: 'local-upload',
      filename: 'fire-red.sav',
      sourceDevice: 'Analogue Pocket',
      profileId: 'firered-gen3-v1',
      importedAt: '2026-09-11T12:00:00.000Z',
      parserVersion: 'test-parser',
      sha256: 'test-hash',
      size: 131_072,
      game: 'Pokemon FireRed',
      gameVersion: 'FR',
      language: 'English',
      checksumsValid: true,
      trainer: { name: 'RED', tid: 1, sid: 2, playTime: '10:00:00' },
      pokemon: [],
      warnings: [],
      rawSaveStored: false,
    }
    let receivedBytes = 0
    const requestedUploadId = '1af862e0-789d-4c88-98be-b17bf02126e4'
    const app = buildApp({
      allowAnonymousPrototype: true,
      importSave: async (bytes, filename) => {
        receivedBytes = bytes.length
        return { ...imported, filename }
      },
    })
    apps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/save-imports/fire-red',
      headers: {
        'content-type': 'application/octet-stream',
        'x-file-name': encodeURIComponent('Pokemon FireRed.srm'),
        'x-upload-id': requestedUploadId,
      },
      payload: Buffer.alloc(131_072),
    })

    expect(response.statusCode).toBe(200)
    expect(receivedBytes).toBe(131_072)
    expect(response.json<SaveImportView>()).toMatchObject({
      filename: 'Pokemon FireRed.srm',
      uploadId: requestedUploadId,
      sourceDevice: 'Analogue Pocket',
      rawSaveStored: false,
    })
  })

  it('rejects wrong-sized and path-shaped save uploads before parsing', async () => {
    let parserCalls = 0
    const app = buildApp({
      allowAnonymousPrototype: true,
      importSave: async () => {
        parserCalls += 1
        throw new Error('should not run')
      },
    })
    apps.push(app)

    const wrongSize = await app.inject({
      method: 'POST',
      url: '/api/save-imports/fire-red',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'fire-red.sav' },
      payload: Buffer.alloc(64),
    })
    const unsafeName = await app.inject({
      method: 'POST',
      url: '/api/save-imports/fire-red',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': '..%2Ffire-red.sav' },
      payload: Buffer.alloc(131_072),
    })

    expect(wrongSize.statusCode).toBe(400)
    expect(wrongSize.json().error).toContain('128 KiB')
    expect(unsafeName.statusCode).toBe(400)
    expect(parserCalls).toBe(0)
  })

  it('locks only server-owned imported Pokémon and starts Showdown with their source values', async () => {
    const imported: SaveImportView = {
      uploadId: 'real-save-import',
      filename: 'Pokemon FireRed.sav',
      sourceDevice: 'Analogue Pocket',
      profileId: 'firered-gen3-v1',
      importedAt: '2026-09-11T12:00:00.000Z',
      parserVersion: 'test-parser',
      sha256: 'test-hash',
      size: 131_072,
      game: 'Pokemon FireRed',
      gameVersion: 'FR',
      language: 'English',
      checksumsValid: true,
      trainer: { name: 'MAY', tid: 1, sid: 2, playTime: '2:16:10' },
      pokemon: [importedMankey],
      warnings: [],
      rawSaveStored: false,
    }
    const app = buildApp({ allowAnonymousPrototype: true, importSave: async () => imported })
    apps.push(app)

    const upload = await app.inject({
      method: 'POST',
      url: '/api/save-imports/fire-red',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav' },
      payload: Buffer.alloc(131_072),
    })
    const registration = await app.inject({
      method: 'POST',
      url: '/api/team-registrations',
      payload: {
        uploadId: upload.json<SaveImportView>().uploadId,
        pokemonFingerprints: [importedMankey.fingerprint],
      },
    })

    expect(registration.statusCode).toBe(200)
    expect(registration.json()).toMatchObject({
      status: 'locked',
      trainerName: 'MAY',
      pokemon: [{ species: 'Mankey', level: 11 }],
      normalization: {
        startsFullyHealed: true,
        movePp: 'showdown-default-maximum',
        sourceSaveModified: false,
      },
    })

    const battle = (await app.inject({ method: 'GET', url: '/api/demo-battle/p1' })).json<DemoBattleView>()
    expect(battle).toMatchObject({
      teamSource: 'registered-save',
      playerName: 'MAY',
      active: { species: 'Mankey', level: 11, hp: 32, maxHp: 32 },
    })
    expect(battle.moves.map((move) => move.name)).toEqual(['Scratch', 'Leer', 'Low Kick', 'Karate Chop'])
    expect(battle.moves.every((move) => move.pp === move.maxPp)).toBe(true)
    expect(battle.registrationId).toBe(registration.json().registrationId)
  })

  it('rejects duplicate and invented Pokémon selections', async () => {
    const imported: SaveImportView = {
      uploadId: 'bounded-import',
      filename: 'Pokemon FireRed.sav',
      sourceDevice: 'Analogue Pocket',
      profileId: 'firered-gen3-v1',
      importedAt: '2026-09-11T12:00:00.000Z',
      parserVersion: 'test-parser',
      sha256: 'test-hash',
      size: 131_072,
      game: 'Pokemon FireRed',
      gameVersion: 'FR',
      language: 'English',
      checksumsValid: true,
      trainer: { name: 'MAY', tid: 1, sid: 2, playTime: '2:16:10' },
      pokemon: [importedMankey],
      warnings: [],
      rawSaveStored: false,
    }
    const app = buildApp({ allowAnonymousPrototype: true, importSave: async () => imported })
    apps.push(app)
    await app.inject({
      method: 'POST',
      url: '/api/save-imports/fire-red',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav' },
      payload: Buffer.alloc(131_072),
    })

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/team-registrations',
      payload: { uploadId: imported.uploadId, pokemonFingerprints: [importedMankey.fingerprint, importedMankey.fingerprint] },
    })
    const invented = await app.inject({
      method: 'POST',
      url: '/api/team-registrations',
      payload: { uploadId: imported.uploadId, pokemonFingerprints: ['invented-pokemon'] },
    })

    expect(duplicate.statusCode).toBe(400)
    expect(duplicate.json().error).toContain('cannot appear')
    expect(invented.statusCode).toBe(400)
    expect(invented.json().error).toContain('not found')
  })

  it('starts a server-owned Showdown battle with private player views', async () => {
    const app = buildApp()
    apps.push(app)
    const [p1Response, p2Response] = await Promise.all([
      app.inject({ method: 'GET', url: '/api/demo-battle/p1' }),
      app.inject({ method: 'GET', url: '/api/demo-battle/p2' }),
    ])
    const p1 = p1Response.json<DemoBattleView>()
    const p2 = p2Response.json<DemoBattleView>()

    expect(p1Response.statusCode).toBe(200)
    expect(p1).toMatchObject({ format: 'gen3customgame', player: 'p1', phase: 'move', turn: 1 })
    expect(p1.engineVersion).toMatch(/^0\.11\./)
    expect(p1.team).toHaveLength(6)
    expect(p1.moves).toHaveLength(4)
    expect(p1.moves[0]).toMatchObject({ name: 'Thunderbolt', type: 'Electric' })
    expect(p1.active?.hp).toBeTypeOf('number')
    expect(p1.opponent?.hp).toBeNull()
    expect(p2.active?.name).not.toBe(p1.active?.name)
    expect(p1.protocol).toContain('|gen|3')
    expect(p1.protocol).toContain('|start')
    expect(p1.protocol.some((line) => line.startsWith('|request|'))).toBe(false)
  })

  it('accepts both players choices and advances the real battle', async () => {
    const app = buildApp()
    apps.push(app)
    const initial = (await app.inject({ method: 'GET', url: '/api/demo-battle/p1' })).json<DemoBattleView>()

    const p1Choice = await app.inject({
      method: 'POST',
      url: '/api/demo-battle/p1/choices',
      payload: { requestId: initial.requestId, idempotencyKey: 'turn-1-p1', type: 'move', slot: 1 },
    })
    expect(p1Choice.statusCode).toBe(200)
    expect(p1Choice.json<DemoBattleView>().phase).toBe('waiting')

    const p2 = (await app.inject({ method: 'GET', url: '/api/demo-battle/p2' })).json<DemoBattleView>()
    const p2Choice = await app.inject({
      method: 'POST',
      url: '/api/demo-battle/p2/choices',
      payload: { requestId: p2.requestId, idempotencyKey: 'turn-1-p2', type: 'move', slot: 1 },
    })
    expect(p2Choice.statusCode).toBe(200)
    const replacementRequest = p2Choice.json<DemoBattleView>()
    expect(replacementRequest.phase).toBe('switch')
    expect(replacementRequest.active?.fainted).toBe(true)
    const moveIndex = replacementRequest.events.findIndex((event) => event.kind === 'move')
    const damageIndex = replacementRequest.events.findIndex((event) => event.kind === 'damage')
    const faintIndex = replacementRequest.events.findIndex((event) => event.kind === 'faint')
    expect(moveIndex).toBeGreaterThanOrEqual(0)
    expect(damageIndex).toBeGreaterThan(moveIndex)
    expect(faintIndex).toBeGreaterThan(damageIndex)
    expect(replacementRequest.events[damageIndex]).toMatchObject({ target: 'player', hpPercent: 0 })
    expect(replacementRequest.protocol.some((line) => line.startsWith('|move|'))).toBe(true)
    expect(replacementRequest.protocol.some((line) => line.startsWith('|request|'))).toBe(false)

    const replacement = await app.inject({
      method: 'POST',
      url: '/api/demo-battle/p2/choices',
      payload: {
        requestId: replacementRequest.requestId,
        idempotencyKey: 'turn-1-p2-replacement',
        type: 'switch',
        slot: 2,
      },
    })
    expect(replacement.statusCode).toBe(200)

    const next = await waitForTurn(app, 2)
    expect(next.phase).toBe('move')
    expect(next.log.some((line) => line.includes('used'))).toBe(true)
  })

  it('rejects illegal and stale choices', async () => {
    const app = buildApp()
    apps.push(app)
    const initial = (await app.inject({ method: 'GET', url: '/api/demo-battle/p1' })).json<DemoBattleView>()

    const illegal = await app.inject({
      method: 'POST',
      url: '/api/demo-battle/p1/choices',
      payload: { requestId: initial.requestId, idempotencyKey: 'illegal', type: 'move', slot: 99 },
    })
    const stale = await app.inject({
      method: 'POST',
      url: '/api/demo-battle/p1/choices',
      payload: { requestId: 0, idempotencyKey: 'stale', type: 'move', slot: 1 },
    })

    expect(illegal.statusCode).toBe(409)
    expect(illegal.json()).toMatchObject({ error: 'That move is not currently available.' })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toContain('Stale battle request')
  })
})

async function waitForTurn(app: ReturnType<typeof buildApp>, turn: number): Promise<DemoBattleView> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 2_000) {
    const view = (await app.inject({ method: 'GET', url: '/api/demo-battle/p1' })).json<DemoBattleView>()
    if (view.turn >= turn) return view
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Battle did not reach turn ${turn}.`)
}
