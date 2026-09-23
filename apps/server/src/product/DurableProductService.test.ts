import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DemoBattleView, SaveImportView, TournamentBracketView } from '@pmb/domain'
import { buildApp } from '../app.js'
import { importedMankey } from '../registrations/testFixtures.js'
import { createTestDurableProductService } from './PgliteTestProductService.js'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('durable product service', () => {
  it('stores global Box Pokémon, trainer personalization, and a tournament team built from owned snapshots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmb-pglite-'))
    tempDirectories.push(directory)
    const imported: SaveImportView = {
      uploadId: '30000000-0000-4000-8000-000000000003', filename: 'Pokemon FireRed.sav',
      sourceDevice: 'Analogue Pocket', profileId: 'firered-gen3-v1', importedAt: '2026-09-13T12:00:00.000Z',
      parserVersion: 'test-parser', sha256: 'box-save-hash', size: 131_072, game: 'Pokemon FireRed', gameVersion: 'FR',
      language: 'English', checksumsValid: true, trainer: { name: 'RED', tid: 1, sid: 2, playTime: '10:00:00' },
      pokemon: [importedMankey], warnings: [], rawSaveStored: false,
    }
    const service = await createTestDurableProductService(directory)
    const app = buildApp({ productService: service, importSave: async () => imported })
    const signup = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { username: 'box_red', displayName: 'Box Red', password: 'pallet-town' },
    })
    const cookie = String(signup.headers['set-cookie']).split(';')[0]!
    const upload = await app.inject({
      method: 'POST', url: '/api/save-imports/fire-red',
      headers: {
        cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav',
        'x-upload-id': imported.uploadId,
      },
      payload: Buffer.alloc(131_072),
    })
    expect(upload.statusCode).toBe(200)

    const box = await app.inject({ method: 'GET', url: '/api/box', headers: { cookie } })
    expect(box.statusCode).toBe(200)
    const snapshotId = box.json<{ pokemon: { snapshotId: string }[] }>().pokemon[0]!.snapshotId
    expect(box.json()).toMatchObject({
      imports: [{ game: 'Pokemon FireRed', pokemonCount: 1 }],
      pokemon: [{ snapshotId, pokemon: { species: 'Mankey', level: 11 } }],
    })

    const card = await app.inject({
      method: 'PATCH', url: '/api/trainer-card', headers: { cookie },
      payload: { trainerSprite: 'leaf-gen3', partnerPokemonSnapshotId: snapshotId },
    })
    expect(card.json()).toMatchObject({
      trainerSprite: 'leaf-gen3', partner: { snapshotId, pokemon: { species: 'Mankey' } },
      stats: { leagues: 0, cups: 0, wins: 0, losses: 0 },
    })

    const league = await app.inject({ method: 'POST', url: '/api/leagues', headers: { cookie }, payload: { name: 'Box League' } })
    const tournament = await app.inject({
      method: 'POST', url: `/api/leagues/${league.json<{ id: string }>().id}/tournaments`, headers: { cookie },
      payload: { name: 'Box Cup', teamSize: 1 },
    })
    const tournamentId = tournament.json<{ id: string }>().id
    const draft = await app.inject({
      method: 'POST', url: `/api/tournaments/${tournamentId}/box-team-draft`, headers: { cookie },
      payload: { pokemonSnapshotIds: [snapshotId] },
    })
    expect(draft.json()).toMatchObject({ draft: { pokemon: [{ species: 'Mankey' }] }, draftPokemonSnapshotIds: [snapshotId] })
    expect((await app.inject({ method: 'POST', url: `/api/tournaments/${tournamentId}/team-lock`, headers: { cookie } })).statusCode).toBe(200)
    await app.close()
  })

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

  it('locks two private teams and reconstructs an authenticated match from journaled choices', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmb-match-'))
    tempDirectories.push(directory)
    const imported: SaveImportView = {
      uploadId: '00000000-0000-4000-8000-000000000001', filename: 'Pokemon FireRed.sav',
      sourceDevice: 'Analogue Pocket', profileId: 'firered-gen3-v1', importedAt: '2026-09-11T12:00:00.000Z',
      parserVersion: 'test-parser', sha256: 'match-hash', size: 131_072, game: 'Pokemon FireRed', gameVersion: 'FR',
      language: 'English', checksumsValid: true, trainer: { name: 'RED', tid: 1, sid: 2, playTime: '10:00:00' },
      pokemon: [importedMankey], warnings: [], rawSaveStored: false,
    }
    const firstService = await createTestDurableProductService(directory)
    const firstApp = buildApp({ productService: firstService, importSave: async () => imported })
    const redSignup = await firstApp.inject({
      method: 'POST', url: '/api/auth/register', payload: { username: 'match_red', displayName: 'Match Red', password: 'pallet-town' },
    })
    const redCookie = String(redSignup.headers['set-cookie']).split(';')[0]!
    const redId = redSignup.json<{ user: { id: string } }>().user.id
    const blueSignup = await firstApp.inject({
      method: 'POST', url: '/api/auth/register', payload: { username: 'match_blue', displayName: 'Match Blue', password: 'viridian-city' },
    })
    const blueCookie = String(blueSignup.headers['set-cookie']).split(';')[0]!
    await Promise.all([
      firstApp.inject({ method: 'PATCH', url: '/api/trainer-card', headers: { cookie: redCookie }, payload: { trainerSprite: 'leaf-gen3' } }),
      firstApp.inject({ method: 'PATCH', url: '/api/trainer-card', headers: { cookie: blueCookie }, payload: { trainerSprite: 'brendan' } }),
    ])
    const spectatorSignup = await firstApp.inject({
      method: 'POST', url: '/api/auth/register', payload: { username: 'match_green', displayName: 'Match Green', password: 'cerulean-city' },
    })
    const spectatorCookie = String(spectatorSignup.headers['set-cookie']).split(';')[0]!
    const league = await firstApp.inject({ method: 'POST', url: '/api/leagues', headers: { cookie: redCookie }, payload: { name: 'Match League' } })
    const leagueId = league.json<{ id: string }>().id
    const search = await firstApp.inject({ method: 'GET', url: '/api/users/search?q=match_blue', headers: { cookie: redCookie } })
    const blueId = search.json<{ users: { id: string }[] }>().users[0]!.id
    const spectatorSearch = await firstApp.inject({ method: 'GET', url: '/api/users/search?q=match_green', headers: { cookie: redCookie } })
    const spectatorId = spectatorSearch.json<{ users: { id: string }[] }>().users[0]!.id
    for (const [userId, invitedCookie] of [[blueId, blueCookie], [spectatorId, spectatorCookie]] as const) {
      await firstApp.inject({
        method: 'POST', url: `/api/leagues/${leagueId}/invitations`, headers: { cookie: redCookie }, payload: { userId },
      })
      const inbox = await firstApp.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: invitedCookie } })
      const invitationId = inbox.json<{ invitations: { id: string }[] }>().invitations[0]!.id
      await firstApp.inject({ method: 'POST', url: `/api/invitations/${invitationId}/accept`, headers: { cookie: invitedCookie } })
    }
    const tournament = await firstApp.inject({
      method: 'POST', url: `/api/leagues/${leagueId}/tournaments`, headers: { cookie: redCookie },
      payload: { name: 'Match Cup', bestOf: 1, teamSize: 1 },
    })
    const tournamentId = tournament.json<{ id: string }>().id
    const selectedEntrants = await firstApp.inject({
      method: 'PUT', url: `/api/tournaments/${tournamentId}/entrants`, headers: { cookie: redCookie },
      payload: { userIds: [redId, blueId] },
    })
    expect(selectedEntrants.json()).toMatchObject({
      entrants: [
        { user: { id: redId }, selected: true, seed: 1 },
        { user: { id: blueId }, selected: true, seed: 2 },
        { user: { id: spectatorId }, selected: false, status: 'not-selected' },
      ],
    })
    expect((await firstApp.inject({
      method: 'GET', url: `/api/tournaments/${tournamentId}/box-team-draft`, headers: { cookie: spectatorCookie },
    })).statusCode).toBe(403)

    for (const [cookie, uploadId] of [
      [redCookie, '10000000-0000-4000-8000-000000000001'],
      [blueCookie, '20000000-0000-4000-8000-000000000002'],
    ] as const) {
      const upload = await firstApp.inject({
        method: 'POST', url: '/api/save-imports/fire-red',
        headers: { cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav', 'x-tournament-id': tournamentId, 'x-upload-id': uploadId },
        payload: Buffer.alloc(131_072),
      })
      expect(upload.statusCode).toBe(200)
      const draft = await firstApp.inject({
        method: 'POST', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie },
        payload: { uploadId, pokemonFingerprints: [importedMankey.fingerprint] },
      })
      expect(draft.statusCode).toBe(200)
      expect((await firstApp.inject({ method: 'POST', url: `/api/tournaments/${tournamentId}/team-lock`, headers: { cookie } })).statusCode).toBe(200)
      const lockedEdit = await firstApp.inject({
        method: 'POST', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie },
        payload: { uploadId, pokemonFingerprints: [importedMankey.fingerprint] },
      })
      expect(lockedEdit.statusCode).toBe(409)
    }

    expect((await firstApp.inject({ method: 'POST', url: `/api/tournaments/${tournamentId}/start`, headers: { cookie: blueCookie } })).statusCode).toBe(403)
    const started = await firstApp.inject({ method: 'POST', url: `/api/tournaments/${tournamentId}/start`, headers: { cookie: redCookie } })
    expect(started.statusCode).toBe(200)
    const bracket = started.json<TournamentBracketView>()
    const battleId = bracket.rounds[0]?.[0]?.battleId
    expect(battleId).toBeTruthy()
    const redView = (await firstApp.inject({ method: 'GET', url: `/api/matches/${battleId}`, headers: { cookie: redCookie } })).json<DemoBattleView>()
    const blueView = (await firstApp.inject({ method: 'GET', url: `/api/matches/${battleId}`, headers: { cookie: blueCookie } })).json<DemoBattleView>()
    expect(redView).toMatchObject({ player: 'p1', playerName: 'Match Red', opponentName: 'Match Blue', teamSource: 'registered-save' })
    expect(blueView).toMatchObject({ player: 'p2', playerName: 'Match Blue', opponentName: 'Match Red', teamSource: 'registered-save' })
    expect(redView.protocol).toContain('|player|p1|Match Red|leaf-gen3|')
    expect(redView.protocol).toContain('|player|p2|Match Blue|brendan|')
    await submitOpenChoice(firstApp, battleId!, redCookie, redView)
    await submitOpenChoice(firstApp, battleId!, blueCookie, blueView)
    const advanced = await waitForMatchTurn(firstApp, battleId!, redCookie, 2)
    expect(advanced.turn).toBeGreaterThanOrEqual(2)
    await firstApp.close()

    const secondService = await createTestDurableProductService(directory)
    const secondApp = buildApp({ productService: secondService })
    let current = await waitForMatchTurn(secondApp, battleId!, redCookie, 2)
    expect(current.team[0]?.species).toBe('Mankey')
    for (let turn = 0; turn < 50 && current.phase !== 'ended'; turn += 1) {
      const red = (await secondApp.inject({ method: 'GET', url: `/api/matches/${battleId}`, headers: { cookie: redCookie } })).json<DemoBattleView>()
      const blue = (await secondApp.inject({ method: 'GET', url: `/api/matches/${battleId}`, headers: { cookie: blueCookie } })).json<DemoBattleView>()
      await submitOpenChoice(secondApp, battleId!, redCookie, red)
      await submitOpenChoice(secondApp, battleId!, blueCookie, blue)
      current = (await secondApp.inject({ method: 'GET', url: `/api/matches/${battleId}`, headers: { cookie: redCookie } })).json<DemoBattleView>()
    }
    expect(current.phase).toBe('ended')
    const completed = await secondApp.inject({ method: 'GET', url: `/api/tournaments/${tournamentId}/match`, headers: { cookie: redCookie } })
    expect(completed.json()).toMatchObject({ status: 'completed', gameNumber: 1 })
    await secondApp.close()
  }, 30_000)

  it('selects entrants and advances a three-player bracket through a bye to a champion', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pmb-bracket-'))
    tempDirectories.push(directory)
    const imported: SaveImportView = {
      uploadId: '00000000-0000-4000-8000-000000000009', filename: 'Pokemon FireRed.sav',
      sourceDevice: 'Analogue Pocket', profileId: 'firered-gen3-v1', importedAt: '2026-09-22T12:00:00.000Z',
      parserVersion: 'test-parser', sha256: 'bracket-hash', size: 131_072, game: 'Pokemon FireRed', gameVersion: 'FR',
      language: 'English', checksumsValid: true, trainer: { name: 'RED', tid: 1, sid: 2, playTime: '10:00:00' },
      pokemon: [importedMankey], warnings: [], rawSaveStored: false,
    }
    const service = await createTestDurableProductService(directory)
    const app = buildApp({ productService: service, importSave: async () => imported })
    const players: Array<{ id: string; cookie: string; name: string }> = []
    for (const [index, name] of ['Seed One', 'Seed Two', 'Seed Three'].entries()) {
      const signup = await app.inject({
        method: 'POST', url: '/api/auth/register',
        payload: { username: `bracket_${index + 1}`, displayName: name, password: 'indigo-plateau' },
      })
      players.push({
        id: signup.json<{ user: { id: string } }>().user.id,
        cookie: String(signup.headers['set-cookie']).split(';')[0]!, name,
      })
    }
    const owner = players[0]!
    const league = await app.inject({ method: 'POST', url: '/api/leagues', headers: { cookie: owner.cookie }, payload: { name: 'Bracket League' } })
    const leagueId = league.json<{ id: string }>().id
    for (const player of players.slice(1)) {
      await app.inject({
        method: 'POST', url: `/api/leagues/${leagueId}/invitations`, headers: { cookie: owner.cookie }, payload: { userId: player.id },
      })
      const inbox = await app.inject({ method: 'GET', url: '/api/invitations', headers: { cookie: player.cookie } })
      const invitationId = inbox.json<{ invitations: { id: string }[] }>().invitations[0]!.id
      await app.inject({ method: 'POST', url: `/api/invitations/${invitationId}/accept`, headers: { cookie: player.cookie } })
    }
    const tournament = await app.inject({
      method: 'POST', url: `/api/leagues/${leagueId}/tournaments`, headers: { cookie: owner.cookie },
      payload: { name: 'Three Player Cup', bestOf: 1, teamSize: 1, entrantIds: players.map((player) => player.id) },
    })
    const tournamentId = tournament.json<{ id: string }>().id
    for (const [index, player] of players.entries()) {
      const uploadId = `${index + 3}0000000-0000-4000-8000-00000000000${index + 3}`
      expect((await app.inject({
        method: 'POST', url: '/api/save-imports/fire-red',
        headers: { cookie: player.cookie, 'content-type': 'application/octet-stream', 'x-file-name': 'Pokemon%20FireRed.sav', 'x-tournament-id': tournamentId, 'x-upload-id': uploadId },
        payload: Buffer.alloc(131_072),
      })).statusCode).toBe(200)
      expect((await app.inject({
        method: 'POST', url: `/api/tournaments/${tournamentId}/team-draft`, headers: { cookie: player.cookie },
        payload: { uploadId, pokemonFingerprints: [importedMankey.fingerprint] },
      })).statusCode).toBe(200)
      expect((await app.inject({ method: 'POST', url: `/api/tournaments/${tournamentId}/team-lock`, headers: { cookie: player.cookie } })).statusCode).toBe(200)
    }
    const started = await app.inject({ method: 'POST', url: `/api/tournaments/${tournamentId}/start`, headers: { cookie: owner.cookie } })
    const openingBracket = started.json<TournamentBracketView>()
    expect(openingBracket).toMatchObject({
      status: 'in-progress', totalRounds: 2,
      rounds: [
        [{ status: 'completed', winner: { id: owner.id } }, { status: 'in-progress' }],
        [{ status: 'pending', playerOne: { id: owner.id }, playerTwo: null }],
      ],
    })
    const semifinal = openingBracket.rounds[0]![1]!
    await service.completeBattle(semifinal.battleId!, players[1]!.id, '|win|Seed Two', 'test-engine')
    const activeFinal = (await app.inject({
      method: 'GET', url: `/api/tournaments/${tournamentId}/bracket`, headers: { cookie: owner.cookie },
    })).json<TournamentBracketView>()
    expect(activeFinal.rounds[1]![0]).toMatchObject({
      status: 'in-progress', playerOne: { id: owner.id }, playerTwo: { id: players[1]!.id },
    })
    const final = activeFinal.rounds[1]![0]!
    await service.completeBattle(final.battleId!, owner.id, '|win|Seed One', 'test-engine')
    const completed = (await app.inject({
      method: 'GET', url: `/api/tournaments/${tournamentId}/bracket`, headers: { cookie: owner.cookie },
    })).json<TournamentBracketView>()
    expect(completed).toMatchObject({ status: 'completed', champion: { id: owner.id } })
    const entrants = (await app.inject({
      method: 'GET', url: `/api/tournaments/${tournamentId}/entrants`, headers: { cookie: owner.cookie },
    })).json<{ entrants: Array<{ user: { id: string }; status: string }> }>()
    expect(entrants.entrants.find((entrant) => entrant.user.id === owner.id)?.status).toBe('champion')
    expect(entrants.entrants.filter((entrant) => entrant.status === 'eliminated')).toHaveLength(2)
    await app.close()
  }, 30_000)
})

async function submitOpenChoice(
  app: ReturnType<typeof buildApp>,
  battleId: string,
  cookie: string,
  view: DemoBattleView,
) {
  if (view.phase !== 'move' && view.phase !== 'switch') return
  const type = view.phase === 'switch' ? 'switch' : 'move'
  const slot = type === 'switch'
    ? view.team.find((pokemon) => !pokemon.active && !pokemon.fainted)?.slot
    : view.moves.find((move) => !move.disabled)?.slot
  if (!slot || view.requestId == null) return
  const response = await app.inject({
    method: 'POST', url: `/api/matches/${battleId}/choices`, headers: { cookie },
    payload: { requestId: view.requestId, idempotencyKey: `${view.player}-${view.requestId}-${type}-${slot}`, type, slot },
  })
  expect(response.statusCode).toBe(200)
}

async function waitForMatchTurn(
  app: ReturnType<typeof buildApp>, battleId: string, cookie: string, expectedTurn: number,
): Promise<DemoBattleView> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const view = (await app.inject({ method: 'GET', url: `/api/matches/${battleId}`, headers: { cookie } })).json<DemoBattleView>()
    if (view.turn >= expectedTurn || view.phase === 'ended') return view
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Battle did not reach turn ${expectedTurn}.`)
}
