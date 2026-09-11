import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  AccountView,
  AuthSessionView,
  LeagueDetailView,
  LeagueInvitationView,
  LeagueRole,
  LeagueSummaryView,
  SaveImportView,
  TeamDraftView,
  TeamDraftWorkspaceView,
  TournamentRulesView,
  TournamentView,
} from '@pmb/domain'

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
  private teamStatuses = new Map<string, 'not-started' | 'drafting' | 'submitted'>()

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
    return tournament
  }

  requireTournamentParticipant(userId: string, tournamentId: string): TournamentView {
    const tournament = this.tournaments.get(tournamentId)
    if (!tournament || !this.memberships.some((entry) => entry.leagueId === tournament.leagueId && entry.userId === userId)) {
      throw new ProductError('Tournament not found.', 404)
    }
    if (tournament.status !== 'planning' && tournament.status !== 'registration-open') {
      throw new ProductError('Team registration is closed for this tournament.', 409)
    }
    return tournament
  }

  markTeamDraft(userId: string, tournamentId: string) {
    const tournament = this.requireTournamentParticipant(userId, tournamentId)
    this.teamStatuses.set(`${tournament.leagueId}:${userId}`, 'drafting')
  }

  persistSaveImport(_userId: string, _tournamentId: string | null, _saveImport: SaveImportView) {}

  loadSaveImport(_userId: string, _tournamentId: string, _uploadId: string): SaveImportView | null {
    return null
  }

  persistTeamDraft(_userId: string, _tournamentId: string, _draft: TeamDraftView) {}

  loadTeamDraft(_userId: string, _tournamentId: string): TeamDraftWorkspaceView | null {
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
