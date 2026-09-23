import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  AccountView,
  AuthSessionView,
  BoxPokemonView,
  BoxTeamDraftWorkspaceView,
  LeagueDetailView,
  LeagueInvitationView,
  LeagueRole,
  LeagueSummaryView,
  LockedTeamView,
  PokemonBoxView,
  SaveImportView,
  TeamDraftView,
  TeamDraftWorkspaceView,
  TournamentBracketView,
  TournamentEntrantsView,
  TournamentRulesView,
  TournamentMatchView,
  TournamentView,
  TrainerCardView,
  TrainerSpriteId,
} from '@pmb/domain'
import { trainerSpriteIds } from '@pmb/domain'

const scrypt = promisify(scryptCallback)

type AccountRecord = AccountView & { passwordSalt: string; passwordHash: string }
type LeagueRecord = { id: string; name: string; createdAt: string }
type MembershipRecord = { leagueId: string; userId: string; role: LeagueRole; joinedAt: string }
type InvitationRecord = {
  id: string
  leagueId: string
  invitedUserId: string
  invitedById: string
  status: LeagueInvitationView['status']
  createdAt: string
}

export type CreateTournamentInput = {
  name?: unknown
  startsAt?: unknown
  teamLockAt?: unknown
  bestOf?: unknown
  teamSize?: unknown
  duplicateSpecies?: unknown
  duplicateHeldItems?: unknown
  entrantIds?: unknown
}

export class ProductError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'ProductError'
  }
}

function now() {
  return new Date().toISOString()
}

function publicAccount(account: AccountRecord): AccountView {
  const { passwordHash: _hash, passwordSalt: _salt, ...view } = account
  return view
}

export class LocalProductService {
  private accounts = new Map<string, AccountRecord>()
  private accountIdsByUsername = new Map<string, string>()
  private sessions = new Map<string, string>()
  private leagues = new Map<string, LeagueRecord>()
  private memberships: MembershipRecord[] = []
  private invitations = new Map<string, InvitationRecord>()
  private tournaments = new Map<string, TournamentView>()
  private tournamentEntrants = new Map<string, Map<string, { seed: number; status: 'selected' | 'drafting' | 'locked' | 'eliminated' | 'champion' }>>()
  private teamStatuses = new Map<string, 'not-started' | 'drafting' | 'submitted'>()
  private saveImports = new Map<string, { userId: string; tournamentId: string | null; data: SaveImportView }>()
  private pokemonSnapshots = new Map<string, BoxPokemonView & { userId: string }>()
  private trainerProfiles = new Map<string, { trainerSprite: TrainerSpriteId; partnerPokemonSnapshotId: string | null }>()
  private boxDrafts = new Map<string, { draft: TeamDraftView; snapshotIds: string[] }>()

  async registerAccount(input: { username?: unknown; displayName?: unknown; password?: unknown }) {
    const username = this.validateUsername(input.username)
    const displayName = this.validateDisplayName(input.displayName)
    const password = this.validatePassword(input.password)
    if (this.accountIdsByUsername.has(username)) throw new ProductError('That username is already taken.', 409)

    const passwordSalt = randomBytes(16).toString('hex')
    const passwordHash = (await scrypt(password, passwordSalt, 64) as Buffer).toString('hex')
    const account: AccountRecord = {
      id: randomUUID(), username, displayName, passwordSalt, passwordHash, createdAt: now(),
    }
    this.accounts.set(account.id, account)
    this.accountIdsByUsername.set(username, account.id)
    return this.createSession(account)
  }

  async login(input: { username?: unknown; password?: unknown }) {
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : ''
    const accountId = this.accountIdsByUsername.get(username)
    const account = accountId ? this.accounts.get(accountId) : undefined
    if (!account || typeof input.password !== 'string') throw new ProductError('Username or password is incorrect.', 401)
    const supplied = await scrypt(input.password, account.passwordSalt, 64) as Buffer
    const expected = Buffer.from(account.passwordHash, 'hex')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ProductError('Username or password is incorrect.', 401)
    }
    return this.createSession(account)
  }

  logout(token: string | null) {
    if (token) this.sessions.delete(token)
  }

  session(token: string | null): AuthSessionView | null {
    const userId = token ? this.sessions.get(token) : undefined
    const account = userId ? this.accounts.get(userId) : undefined
    return account ? { user: publicAccount(account) } : null
  }

  requireUser(token: string | null): AccountView {
    const session = this.session(token)
    if (!session) throw new ProductError('Sign in to continue.', 401)
    return session.user
  }

  listPokemonBox(userId: string, profileId?: string): PokemonBoxView {
    const imports = [...this.saveImports.values()]
      .filter((entry) => entry.userId === userId && (!profileId || entry.data.profileId === profileId))
      .map((entry) => entry.data)
      .filter((item, index, values) => values.findIndex((candidate) => candidate.sha256 === item.sha256) === index)
      .map((item) => ({
        uploadId: item.uploadId, profileId: item.profileId, game: item.game, gameVersion: item.gameVersion,
        filename: item.filename, importedAt: item.importedAt, trainerName: item.trainer.name, pokemonCount: item.pokemon.length,
      }))
    const pokemon = [...this.pokemonSnapshots.values()]
      .filter((entry) => entry.userId === userId && (!profileId || entry.profileId === profileId))
      .filter((item, index, values) => values.findIndex((candidate) => candidate.pokemon.fingerprint === item.pokemon.fingerprint) === index)
      .map(({ userId: _userId, ...item }) => structuredClone(item))
    return { imports, pokemon }
  }

  getTrainerCard(userId: string): TrainerCardView {
    const account = this.accounts.get(userId)
    if (!account) throw new ProductError('Trainer not found.', 404)
    const profile = this.trainerProfiles.get(userId)
    const partner = profile?.partnerPokemonSnapshotId ? this.pokemonSnapshots.get(profile.partnerPokemonSnapshotId) : undefined
    const leagues = this.memberships.filter((entry) => entry.userId === userId)
    return {
      user: publicAccount(account),
      trainerSprite: profile?.trainerSprite ?? 'red',
      partner: partner ? (({ userId: _userId, ...item }) => structuredClone(item))(partner) : null,
      stats: {
        leagues: leagues.length,
        cups: [...this.tournaments.values()].filter((event) => leagues.some((membership) => membership.leagueId === event.leagueId)).length,
        wins: 0,
        losses: 0,
      },
    }
  }

  updateTrainerCard(userId: string, input: { trainerSprite?: unknown; partnerPokemonSnapshotId?: unknown }): TrainerCardView {
    const current = this.trainerProfiles.get(userId) ?? { trainerSprite: 'red' as const, partnerPokemonSnapshotId: null }
    if (input.trainerSprite !== undefined) {
      if (typeof input.trainerSprite !== 'string' || !trainerSpriteIds.includes(input.trainerSprite as TrainerSpriteId)) {
        throw new ProductError('Choose a supported trainer sprite.', 400)
      }
      current.trainerSprite = input.trainerSprite as TrainerSpriteId
    }
    if (input.partnerPokemonSnapshotId !== undefined) {
      if (input.partnerPokemonSnapshotId !== null && (
        typeof input.partnerPokemonSnapshotId !== 'string' || this.pokemonSnapshots.get(input.partnerPokemonSnapshotId)?.userId !== userId
      )) throw new ProductError('That Pokémon is not in your Box.', 404)
      current.partnerPokemonSnapshotId = input.partnerPokemonSnapshotId as string | null
    }
    this.trainerProfiles.set(userId, current)
    return this.getTrainerCard(userId)
  }

  createLeague(userId: string, input: { name?: unknown }): LeagueDetailView {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length < 2 || name.length > 60) throw new ProductError('League names must be 2–60 characters.', 400)
    const league = { id: randomUUID(), name, createdAt: now() }
    this.leagues.set(league.id, league)
    this.memberships.push({ leagueId: league.id, userId, role: 'owner', joinedAt: league.createdAt })
    return this.getLeague(userId, league.id)
  }

  listLeagues(userId: string): readonly LeagueSummaryView[] {
    return this.memberships.filter((entry) => entry.userId === userId).map((membership) => {
      const league = this.leagues.get(membership.leagueId)!
      const tournaments = this.leagueTournaments(league.id)
      return {
        ...league,
        role: membership.role,
        memberCount: this.memberships.filter((entry) => entry.leagueId === league.id).length,
        nextTournament: tournaments.find((event) => event.status !== 'completed') ?? null,
      }
    })
  }

  getLeague(userId: string, leagueId: string): LeagueDetailView {
    const membership = this.memberships.find((entry) => entry.userId === userId && entry.leagueId === leagueId)
    const league = this.leagues.get(leagueId)
    if (!league || !membership) throw new ProductError('League not found.', 404)
    return {
      ...league,
      currentUserRole: membership.role,
      members: this.memberships.filter((entry) => entry.leagueId === leagueId).map((entry) => ({
        user: publicAccount(this.accounts.get(entry.userId)!),
        role: entry.role,
        joinedAt: entry.joinedAt,
        teamStatus: this.teamStatuses.get(`${leagueId}:${entry.userId}`) ?? 'not-started',
      })),
      tournaments: this.leagueTournaments(leagueId),
    }
  }

  searchUsers(userId: string, query: string): readonly AccountView[] {
    const normalized = query.trim().toLowerCase()
    if (normalized.length < 2) return []
    return [...this.accounts.values()]
      .filter((account) => account.id !== userId && (
        account.username.includes(normalized) || account.displayName.toLowerCase().includes(normalized)
      ))
      .slice(0, 10)
      .map(publicAccount)
  }

  inviteUser(actorId: string, leagueId: string, targetUserId: string): LeagueInvitationView {
    this.requireLeagueAdmin(actorId, leagueId)
    if (!this.accounts.has(targetUserId)) throw new ProductError('User not found.', 404)
    if (this.memberships.some((entry) => entry.leagueId === leagueId && entry.userId === targetUserId)) {
      throw new ProductError('That player is already in the league.', 409)
    }
    if ([...this.invitations.values()].some((entry) => entry.leagueId === leagueId && entry.invitedUserId === targetUserId && entry.status === 'pending')) {
      throw new ProductError('That player already has a pending invitation.', 409)
    }
    const invitation: InvitationRecord = {
      id: randomUUID(), leagueId, invitedUserId: targetUserId, invitedById: actorId, status: 'pending', createdAt: now(),
    }
    this.invitations.set(invitation.id, invitation)
    return this.invitationView(invitation)
  }

  listInvitations(userId: string): readonly LeagueInvitationView[] {
    return [...this.invitations.values()]
      .filter((entry) => entry.invitedUserId === userId && entry.status === 'pending')
      .map((entry) => this.invitationView(entry))
  }

  acceptInvitation(userId: string, invitationId: string): LeagueDetailView {
    const invitation = this.invitations.get(invitationId)
    if (!invitation || invitation.invitedUserId !== userId || invitation.status !== 'pending') {
      throw new ProductError('Invitation not found.', 404)
    }
    invitation.status = 'accepted'
    this.memberships.push({ leagueId: invitation.leagueId, userId, role: 'player', joinedAt: now() })
    return this.getLeague(userId, invitation.leagueId)
  }

  createTournament(actorId: string, leagueId: string, input: CreateTournamentInput): TournamentView {
    this.requireLeagueAdmin(actorId, leagueId)
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length < 2 || name.length > 60) throw new ProductError('Tournament names must be 2–60 characters.', 400)
    const bestOf = input.bestOf === 1 || input.bestOf === 3 || input.bestOf === 5 ? input.bestOf : 3
    const teamSize = typeof input.teamSize === 'number' ? input.teamSize : 6
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 6) throw new ProductError('Team size must be between 1 and 6.', 400)
    const startsAt = this.optionalDate(input.startsAt, 'start')
    const teamLockAt = this.optionalDate(input.teamLockAt, 'team lock')
    if (startsAt && teamLockAt && teamLockAt > startsAt) throw new ProductError('Team lock must be at or before the tournament start.', 400)
    const rules: TournamentRulesView = {
      gameProfileId: 'firered-gen3-v1', battleFormat: 'singles', bracket: 'single-elimination',
      bestOf, teamSize, levelPolicy: 'actual-levels', teamPreview: false,
      duplicateSpecies: input.duplicateSpecies === true,
      duplicateHeldItems: input.duplicateHeldItems === true,
      usableBagItems: false,
    }
    const tournament: TournamentView = {
      id: randomUUID(), leagueId, name, status: 'registration-open', startsAt, teamLockAt, rules, createdAt: now(),
    }
    this.tournaments.set(tournament.id, tournament)
    const memberIds = this.memberships.filter((entry) => entry.leagueId === leagueId).map((entry) => entry.userId)
    const requestedIds = Array.isArray(input.entrantIds) ? input.entrantIds : memberIds
    const entrantIds = [...new Set(requestedIds.filter((id): id is string => typeof id === 'string'))]
    if (Array.isArray(input.entrantIds) && entrantIds.length < 2) throw new ProductError('Choose at least two tournament entrants.', 400)
    if (entrantIds.some((id) => !memberIds.includes(id))) throw new ProductError('Tournament entrants must be league members.', 400)
    this.tournamentEntrants.set(tournament.id, new Map(entrantIds.map((id, index) => [id, { seed: index + 1, status: 'selected' as const }])))
    return tournament
  }

  getTournamentEntrants(userId: string, tournamentId: string): TournamentEntrantsView {
    const tournament = this.requireTournamentMember(userId, tournamentId)
    const selected = this.tournamentEntrants.get(tournamentId) ?? new Map()
    return {
      tournamentId,
      editable: tournament.status === 'planning' || tournament.status === 'registration-open',
      entrants: this.memberships.filter((entry) => entry.leagueId === tournament.leagueId).map((entry) => {
        const entrant = selected.get(entry.userId)
        return {
          user: publicAccount(this.accounts.get(entry.userId)!), selected: Boolean(entrant),
          seed: entrant?.seed ?? null, status: entrant?.status ?? 'not-selected',
        }
      }),
    }
  }

  setTournamentEntrants(actorId: string, tournamentId: string, userIds: readonly string[]): TournamentEntrantsView {
    const tournament = this.tournaments.get(tournamentId)
    if (!tournament) throw new ProductError('Tournament not found.', 404)
    this.requireLeagueAdmin(actorId, tournament.leagueId)
    if (tournament.status !== 'planning' && tournament.status !== 'registration-open') throw new ProductError('Entrants cannot change after the tournament starts.', 409)
    const uniqueIds = [...new Set(userIds)]
    if (uniqueIds.length < 2) throw new ProductError('Choose at least two tournament entrants.', 400)
    const memberIds = this.memberships.filter((entry) => entry.leagueId === tournament.leagueId).map((entry) => entry.userId)
    if (uniqueIds.some((id) => !memberIds.includes(id))) throw new ProductError('Tournament entrants must be league members.', 400)
    const current = this.tournamentEntrants.get(tournamentId) ?? new Map()
    for (const [id, entrant] of current) {
      if (!uniqueIds.includes(id) && entrant.status !== 'selected') throw new ProductError('A player with team activity cannot be removed from this tournament.', 409)
    }
    this.tournamentEntrants.set(tournamentId, new Map(uniqueIds.map((id, index) => [id, {
      seed: index + 1, status: current.get(id)?.status ?? 'selected',
    }])))
    return this.getTournamentEntrants(actorId, tournamentId)
  }

  requireTournamentParticipant(userId: string, tournamentId: string): TournamentView {
    const tournament = this.requireTournamentMember(userId, tournamentId)
    if (tournament.status !== 'planning' && tournament.status !== 'registration-open') {
      throw new ProductError('Team registration is closed for this tournament.', 409)
    }
    if (!this.tournamentEntrants.get(tournamentId)?.has(userId)) throw new ProductError('You are not selected for this tournament.', 403)
    return tournament
  }

  requireTournamentMember(userId: string, tournamentId: string): TournamentView {
    const tournament = this.tournaments.get(tournamentId)
    if (!tournament || !this.memberships.some((entry) => entry.leagueId === tournament.leagueId && entry.userId === userId)) {
      throw new ProductError('Tournament not found.', 404)
    }
    return tournament
  }

  markTeamDraft(userId: string, tournamentId: string) {
    const tournament = this.requireTournamentParticipant(userId, tournamentId)
    this.teamStatuses.set(`${tournament.leagueId}:${userId}`, 'drafting')
    const entrant = this.tournamentEntrants.get(tournamentId)?.get(userId)
    if (entrant) entrant.status = 'drafting'
  }

  persistSaveImport(userId: string, tournamentId: string | null, saveImport: SaveImportView) {
    this.saveImports.set(saveImport.uploadId, { userId, tournamentId, data: structuredClone(saveImport) })
    for (const pokemon of saveImport.pokemon) {
      const snapshotId = randomUUID()
      this.pokemonSnapshots.set(snapshotId, {
        userId, snapshotId, uploadId: saveImport.uploadId, profileId: saveImport.profileId,
        game: saveImport.game, gameVersion: saveImport.gameVersion, filename: saveImport.filename,
        importedAt: saveImport.importedAt, pokemon: structuredClone(pokemon),
      })
    }
  }

  loadSaveImport(userId: string, tournamentId: string, uploadId: string): SaveImportView | null {
    const saved = this.saveImports.get(uploadId)
    return saved?.userId === userId && saved.tournamentId === tournamentId
      ? structuredClone(saved.data)
      : null
  }

  loadOwnedSaveImport(userId: string, uploadId: string): SaveImportView | null {
    const saved = this.saveImports.get(uploadId)
    return saved?.userId === userId ? structuredClone(saved.data) : null
  }

  saveBoxTeamDraft(userId: string, tournamentId: string, snapshotIds: readonly string[]): BoxTeamDraftWorkspaceView {
    const tournament = this.requireTournamentParticipant(userId, tournamentId)
    const box = this.listPokemonBox(userId, tournament.rules.gameProfileId)
    const byId = new Map(box.pokemon.map((item) => [item.snapshotId, item]))
    const selected = snapshotIds.map((id) => byId.get(id))
    if (!snapshotIds.length || snapshotIds.length > tournament.rules.teamSize || selected.some((item) => !item)) {
      throw new ProductError('Choose eligible Pokémon from your Box.', 422)
    }
    const primary = selected[0]!
    const imported = this.saveImports.get(primary.uploadId)!.data
    const draft: TeamDraftView = {
      draftId: randomUUID(), uploadId: primary.uploadId, tournamentId, profileId: imported.profileId,
      trainerName: imported.trainer.name, savedAt: now(), status: 'draft',
      pokemon: selected.map((item) => item!.pokemon),
      normalization: { startsFullyHealed: true, movePp: 'showdown-default-maximum', sourceSaveModified: false },
    }
    this.boxDrafts.set(`${tournamentId}:${userId}`, { draft, snapshotIds: [...snapshotIds] })
    this.markTeamDraft(userId, tournamentId)
    return { tournament, eligiblePokemon: box.pokemon, draft, draftPokemonSnapshotIds: [...snapshotIds] }
  }

  getBoxTeamDraftWorkspace(userId: string, tournamentId: string): BoxTeamDraftWorkspaceView {
    const tournament = this.requireTournamentParticipant(userId, tournamentId)
    const saved = this.boxDrafts.get(`${tournamentId}:${userId}`)
    return {
      tournament,
      eligiblePokemon: this.listPokemonBox(userId, tournament.rules.gameProfileId).pokemon,
      draft: saved?.draft ?? null,
      draftPokemonSnapshotIds: saved?.snapshotIds ?? [],
    }
  }

  persistTeamDraft(_userId: string, _tournamentId: string, _draft: TeamDraftView) {}

  loadTeamDraft(_userId: string, _tournamentId: string): TeamDraftWorkspaceView | null {
    return null
  }

  getLockedTeam(_userId: string, _tournamentId: string): LockedTeamView | null {
    return null
  }

  lockTeam(_userId: string, _tournamentId: string): LockedTeamView {
    throw new ProductError('Team locking requires the PostgreSQL product runtime.', 501)
  }

  startTournament(_actorId: string, _tournamentId: string, _engineVersion: string): TournamentBracketView {
    throw new ProductError('Tournament matches require the PostgreSQL product runtime.', 501)
  }

  getTournamentBracket(userId: string, tournamentId: string): TournamentBracketView {
    const tournament = this.requireTournamentMember(userId, tournamentId)
    return { tournamentId, status: tournament.status, totalRounds: 0, rounds: [], champion: null }
  }

  getTournamentMatch(_userId: string, _tournamentId: string): TournamentMatchView | null {
    return null
  }

  private createSession(account: AccountRecord) {
    const token = randomBytes(32).toString('base64url')
    this.sessions.set(token, account.id)
    return { token, session: { user: publicAccount(account) } satisfies AuthSessionView }
  }

  private requireLeagueAdmin(userId: string, leagueId: string) {
    const membership = this.memberships.find((entry) => entry.userId === userId && entry.leagueId === leagueId)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      throw new ProductError('Only league admins can do that.', 403)
    }
  }

  private leagueTournaments(leagueId: string) {
    return [...this.tournaments.values()].filter((event) => event.leagueId === leagueId)
  }

  private invitationView(invitation: InvitationRecord): LeagueInvitationView {
    return {
      id: invitation.id,
      leagueId: invitation.leagueId,
      leagueName: this.leagues.get(invitation.leagueId)!.name,
      invitedUser: publicAccount(this.accounts.get(invitation.invitedUserId)!),
      invitedBy: publicAccount(this.accounts.get(invitation.invitedById)!),
      status: invitation.status,
      createdAt: invitation.createdAt,
    }
  }

  private validateUsername(value: unknown) {
    const username = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new ProductError('Use 3–20 letters, numbers, or underscores for your username.', 400)
    return username
  }

  private validateDisplayName(value: unknown) {
    const name = typeof value === 'string' ? value.trim() : ''
    if (name.length < 1 || name.length > 40) throw new ProductError('Display names must be 1–40 characters.', 400)
    return name
  }

  private validatePassword(value: unknown) {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new ProductError('Passwords must be at least 8 characters.', 400)
    return value
  }

  private optionalDate(value: unknown, label: string) {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new ProductError(`Enter a valid ${label} date.`, 400)
    return new Date(value).toISOString()
  }
}
