import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import {
  publicProfiles,
  type DemoBattleChoice,
  type DemoPlayerId,
  type TeamRegistrationRequest,
} from '@pmb/domain'
import { BattleRequestError, DemoBattleManager, showdownEngineVersion } from './battle/DemoBattleManager.js'
import { MatchBattleCoordinator } from './battle/MatchBattleCoordinator.js'
import {
  fireRedSaveSize,
  importFireRedSave,
  SaveImportError,
  validateSaveBytes,
  validateSaveFilename,
} from './imports/SaveParserClient.js'
import { LocalTeamRegistry, TeamRegistrationError } from './registrations/LocalTeamRegistry.js'
import { LocalProductService, ProductError, type CreateTournamentInput } from './product/LocalProductService.js'
import { DurableProductService } from './product/DurableProductService.js'

function playerId(value: unknown): DemoPlayerId | null {
  return value === 'p1' || value === 'p2' ? value : null
}

function battleChoice(value: unknown): DemoBattleChoice | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.requestId !== 'number' ||
    typeof candidate.idempotencyKey !== 'string' ||
    candidate.idempotencyKey.length < 1 ||
    (candidate.type !== 'move' && candidate.type !== 'switch') ||
    typeof candidate.slot !== 'number'
  ) return null
  return candidate as DemoBattleChoice
}

function requestedUploadId(value: unknown): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ProductError('The save upload ID is invalid.', 400)
  }
  return value
}

type BuildAppOptions = {
  importSave?: typeof importFireRedSave
  productService?: LocalProductService | DurableProductService
  allowAnonymousPrototype?: boolean
  staticRoot?: string
}

const sessionCookie = 'pmb_session'

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) return decodeURIComponent(value.join('='))
  }
  return null
}

function sessionHeader(token: string) {
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''
  return `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: false })
  const demoBattle = new DemoBattleManager()
  const teams = new LocalTeamRegistry()
  const product = options.productService ?? new LocalProductService()
  const matchBattles = product instanceof DurableProductService ? new MatchBattleCoordinator(product) : null
  const runSaveImport = options.importSave ?? importFireRedSave

  app.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: fireRedSaveSize },
    (_request, body, done) => done(null, body),
  )

  void app.register(cors, {
    origin: process.env.WEB_ORIGIN ?? 'http://127.0.0.1:5173',
    credentials: true,
  })

  app.get('/api/health', async () => ({
    service: 'pocket-monster-brawl-api',
    status: 'ok',
  }))

  app.get('/api/profiles', async () => ({ profiles: publicProfiles }))

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProductError) return reply.code(error.statusCode).send({ error: error.message })
    return reply.send(error)
  })

  const currentUser = (request: { headers: { cookie?: string } }) =>
    product.requireUser(cookieValue(request.headers.cookie, sessionCookie))

  app.post<{ Body: { username?: unknown; displayName?: unknown; password?: unknown } }>('/api/auth/register', async (request, reply) => {
    const created = await product.registerAccount(request.body ?? {})
    reply.header('set-cookie', sessionHeader(created.token))
    return created.session
  })

  app.post<{ Body: { username?: unknown; password?: unknown } }>('/api/auth/login', async (request, reply) => {
    const created = await product.login(request.body ?? {})
    reply.header('set-cookie', sessionHeader(created.token))
    return created.session
  })

  app.post('/api/auth/logout', async (request, reply) => {
    await product.logout(cookieValue(request.headers.cookie, sessionCookie))
    reply.header('set-cookie', `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
    return { ok: true }
  })

  app.get('/api/auth/session', async (request, reply) => {
    const session = await product.session(cookieValue(request.headers.cookie, sessionCookie))
    if (!session) return reply.code(401).send({ error: 'Not signed in.' })
    return session
  })

  app.get('/api/leagues', async (request) => ({ leagues: await product.listLeagues((await currentUser(request)).id) }))
  app.post<{ Body: { name?: unknown } }>('/api/leagues', async (request) =>
    product.createLeague((await currentUser(request)).id, request.body ?? {}))
  app.get<{ Params: { leagueId: string } }>('/api/leagues/:leagueId', async (request) =>
    product.getLeague((await currentUser(request)).id, request.params.leagueId))
  app.get<{ Querystring: { q?: string } }>('/api/users/search', async (request) => ({
    users: await product.searchUsers((await currentUser(request)).id, request.query.q ?? ''),
  }))
  app.get('/api/invitations', async (request) => ({ invitations: await product.listInvitations((await currentUser(request)).id) }))
  app.post<{ Params: { leagueId: string }; Body: { userId?: unknown } }>('/api/leagues/:leagueId/invitations', async (request) => {
    const userId = typeof request.body?.userId === 'string' ? request.body.userId : ''
    return product.inviteUser((await currentUser(request)).id, request.params.leagueId, userId)
  })
  app.post<{ Params: { invitationId: string } }>('/api/invitations/:invitationId/accept', async (request) =>
    product.acceptInvitation((await currentUser(request)).id, request.params.invitationId))
  app.post<{ Params: { leagueId: string }; Body: CreateTournamentInput }>('/api/leagues/:leagueId/tournaments', async (request) =>
    product.createTournament((await currentUser(request)).id, request.params.leagueId, request.body ?? {}))

  app.get<{ Params: { tournamentId: string } }>('/api/tournaments/:tournamentId/team-lock', async (request, reply) => {
    const user = await currentUser(request)
    await product.requireTournamentMember(user.id, request.params.tournamentId)
    const locked = await product.getLockedTeam(user.id, request.params.tournamentId)
    if (!locked) return reply.code(404).send({ error: 'No team has been locked yet.' })
    return locked
  })

  app.post<{ Params: { tournamentId: string } }>('/api/tournaments/:tournamentId/team-lock', async (request) => {
    const user = await currentUser(request)
    return product.lockTeam(user.id, request.params.tournamentId)
  })

  app.post<{ Params: { tournamentId: string } }>('/api/tournaments/:tournamentId/start', async (request) => {
    const user = await currentUser(request)
    return product.startTwoPlayerTournament(user.id, request.params.tournamentId, showdownEngineVersion)
  })

  app.get<{ Params: { tournamentId: string } }>('/api/tournaments/:tournamentId/match', async (request, reply) => {
    const user = await currentUser(request)
    await product.requireTournamentMember(user.id, request.params.tournamentId)
    const match = await product.getTournamentMatch(user.id, request.params.tournamentId)
    if (!match) return reply.code(404).send({ error: 'No match has been created yet.' })
    return match
  })

  app.get<{ Params: { battleId: string } }>('/api/matches/:battleId', async (request) => {
    if (!matchBattles) throw new ProductError('Authenticated matches require the PostgreSQL product runtime.', 501)
    const user = await currentUser(request)
    return matchBattles.getView(user.id, request.params.battleId)
  })

  app.post<{ Params: { battleId: string }; Body: unknown }>('/api/matches/:battleId/choices', async (request, reply) => {
    if (!matchBattles) throw new ProductError('Authenticated matches require the PostgreSQL product runtime.', 501)
    const user = await currentUser(request)
    const choice = battleChoice(request.body)
    if (!choice) return reply.code(400).send({ error: 'A valid battle choice is required.' })
    try {
      return await matchBattles.submit(user.id, request.params.battleId, choice)
    } catch (error) {
      if (error instanceof BattleRequestError) return reply.code(error.statusCode).send({ error: error.message })
      throw error
    }
  })

  app.post<{ Params: { tournamentId: string }; Body: TeamRegistrationRequest }>('/api/tournaments/:tournamentId/team-draft', async (request) => {
    const user = await currentUser(request)
    await product.requireTournamentParticipant(user.id, request.params.tournamentId)
    const persistedImport = await product.loadSaveImport(user.id, request.params.tournamentId, request.body.uploadId)
    if (persistedImport) teams.rememberImport(persistedImport, user.id, request.params.tournamentId)
    const draft = teams.saveDraft(
      { ...request.body, tournamentId: request.params.tournamentId },
      user.id,
      request.params.tournamentId,
    )
    await product.persistTeamDraft(user.id, request.params.tournamentId, draft)
    await product.markTeamDraft(user.id, request.params.tournamentId)
    return draft
  })

  app.get<{ Params: { tournamentId: string } }>('/api/tournaments/:tournamentId/team-draft', async (request, reply) => {
    const user = await currentUser(request)
    await product.requireTournamentMember(user.id, request.params.tournamentId)
    const workspace = await product.loadTeamDraft(user.id, request.params.tournamentId)
      ?? teams.currentDraft(user.id, request.params.tournamentId)
    if (!workspace) return reply.code(404).send({ error: 'No team draft has been saved yet.' })
    teams.rememberImport(workspace.saveImport, user.id, request.params.tournamentId)
    return workspace
  })

  app.post<{ Body: Buffer }>('/api/save-imports/fire-red', async (request, reply) => {
    try {
      const user = options.allowAnonymousPrototype ? null : await currentUser(request)
      const tournamentId = typeof request.headers['x-tournament-id'] === 'string'
        ? request.headers['x-tournament-id']
        : null
      if (!options.allowAnonymousPrototype) {
        if (!tournamentId) throw new ProductError('Choose a tournament before importing a team.', 400)
        await product.requireTournamentParticipant(user!.id, tournamentId)
      }
      const requestedId = requestedUploadId(request.headers['x-upload-id'])
      if (user && tournamentId && requestedId) {
        const completed = await product.loadSaveImport(user.id, tournamentId, requestedId)
        if (completed) return reply.header('cache-control', 'no-store').send(completed)
      }
      const filename = validateSaveFilename(request.headers['x-file-name'])
      const bytes = validateSaveBytes(request.body)
      const parsed = await runSaveImport(bytes, filename)
      const imported = requestedId ? { ...parsed, uploadId: requestedId } : parsed
      teams.rememberImport(imported, user?.id ?? null, tournamentId)
      if (user) await product.persistSaveImport(user.id, tournamentId, imported)
      return reply.header('cache-control', 'no-store').send(imported)
    } catch (error) {
      if (error instanceof SaveImportError) {
        return reply.code(error.statusCode).send({ error: error.message })
      }
      throw error
    }
  })

  app.get<{ Params: { tournamentId: string; uploadId: string } }>(
    '/api/tournaments/:tournamentId/save-imports/:uploadId',
    async (request, reply) => {
      const user = await currentUser(request)
      await product.requireTournamentParticipant(user.id, request.params.tournamentId)
      const imported = await product.loadSaveImport(user.id, request.params.tournamentId, request.params.uploadId)
      if (!imported) return reply.code(404).header('cache-control', 'no-store').send({ error: 'The save import is still processing.' })
      return reply.header('cache-control', 'no-store').send(imported)
    },
  )

  app.get('/api/team-registrations/current', async (_request, reply) => {
    const registration = teams.current()
    if (!registration) return reply.code(404).send({ error: 'No team has been registered yet.' })
    return registration.view
  })

  app.post<{ Body: TeamRegistrationRequest }>('/api/team-registrations', async (request, reply) => {
    try {
      const user = options.allowAnonymousPrototype ? null : await currentUser(request)
      const tournamentId = request.body?.tournamentId ?? null
      if (!options.allowAnonymousPrototype) {
        if (!tournamentId) throw new ProductError('Choose a tournament before registering a team.', 400)
        await product.requireTournamentParticipant(user!.id, tournamentId)
      }
      const registration = teams.register(request.body, user?.id ?? null, tournamentId)
      await demoBattle.useRegisteredTeam('p1', {
        packedTeam: registration.packedTeam,
        registrationId: registration.view.registrationId,
        trainerName: registration.view.trainerName,
      })
      return registration.view
    } catch (error) {
      if (error instanceof TeamRegistrationError) {
        return reply.code(error.statusCode).send({ error: error.message })
      }
      throw error
    }
  })

  app.get<{ Params: { player: string } }>('/api/demo-battle/:player', async (request, reply) => {
    const player = playerId(request.params.player)
    if (!player) return reply.code(404).send({ error: 'Demo player not found.' })
    return demoBattle.getView(player)
  })

  app.post('/api/demo-battle/reset', async () => {
    await demoBattle.reset()
    return demoBattle.getView('p1')
  })

  app.post<{ Params: { player: string }; Body: unknown }>(
    '/api/demo-battle/:player/choices',
    async (request, reply) => {
      const player = playerId(request.params.player)
      if (!player) return reply.code(404).send({ error: 'Demo player not found.' })
      const choice = battleChoice(request.body)
      if (!choice) return reply.code(400).send({ error: 'A valid battle choice is required.' })

      try {
        return await demoBattle.submit(player, choice)
      } catch (error) {
        if (error instanceof BattleRequestError) {
          return reply.code(error.statusCode).send({ error: error.message })
        }
        throw error
      }
    },
  )

  app.addHook('onClose', async () => {
    await matchBattles?.close()
    await demoBattle.close()
    if ('close' in product) await product.close()
  })

  if (options.staticRoot) {
    void app.register(fastifyStatic, { root: options.staticRoot, wildcard: false })
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: 'Not found.' })
    })
  }

  return app
}
