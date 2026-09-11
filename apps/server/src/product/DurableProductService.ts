import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import {
  publicProfiles,
  type AccountView,
  type AuthSessionView,
  type LeagueDetailView,
  type LeagueInvitationView,
  type LeagueRole,
  type LeagueSummaryView,
  type SaveImportView,
  type TeamDraftView,
  type TeamDraftWorkspaceView,
  type TournamentRulesView,
  type TournamentView,
} from '@pmb/domain'
import { ProductError, type CreateTournamentInput } from './LocalProductService.js'

const scrypt = promisify(scryptCallback)
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000

type DbUser = { id: string; username: string; display_name: string; password_hash: string; created_at: Date | string }
type DbTournament = { id: string; league_id: string; name: string; status: TournamentView['status']; starts_at: Date | string | null; team_lock_at: Date | string | null; created_at: Date | string }
type SqlResult<T> = { rows: T[] }
export type SqlExecutor = { query<T>(statement: string, parameters?: unknown[]): Promise<SqlResult<T>> }
export type ProductDatabase = SqlExecutor & { transaction<T>(work: (database: SqlExecutor) => Promise<T>): Promise<T>; close(): Promise<void> }
function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function account(row: DbUser): AccountView {
  return { id: row.id, username: row.username, displayName: row.display_name, createdAt: iso(row.created_at) }
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function json<T>(value: T | string): T {
  return typeof value === 'string' ? JSON.parse(value) as T : value
}

export class DurableProductService {
  constructor(private readonly db: ProductDatabase) {}

  async close() {
    await this.db.close()
  }

  async registerAccount(input: { username?: unknown; displayName?: unknown; password?: unknown }) {
    const username = this.validateUsername(input.username)
    const displayName = this.validateDisplayName(input.displayName)
    const password = this.validatePassword(input.password)
    const existing = await this.db.query<{ id: string }>('select id from users where username = $1', [username])
    if (existing.rows.length) throw new ProductError('That username is already taken.', 409)
    const salt = randomBytes(16).toString('hex')
    const hash = (await scrypt(password, salt, 64) as Buffer).toString('hex')
    const result = await this.db.query<DbUser>(
      'insert into users (username, display_name, password_hash) values ($1, $2, $3) returning *',
      [username, displayName, `${salt}:${hash}`],
    )
    return this.createSession(result.rows[0]!)
  }

  async login(input: { username?: unknown; password?: unknown }) {
    const username = typeof input.username === 'string' ? input.username.trim().toLowerCase() : ''
    const result = await this.db.query<DbUser>('select * from users where username = $1', [username])
    const user = result.rows[0]
    if (!user || typeof input.password !== 'string') throw new ProductError('Username or password is incorrect.', 401)
    const [salt, expectedHex] = user.password_hash.split(':')
    if (!salt || !expectedHex) throw new ProductError('Username or password is incorrect.', 401)
    const supplied = await scrypt(input.password, salt, 64) as Buffer
    const expected = Buffer.from(expectedHex, 'hex')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new ProductError('Username or password is incorrect.', 401)
    }
    return this.createSession(user)
  }

  async logout(token: string | null) {
    if (token) await this.db.query('delete from sessions where token_hash = $1', [tokenHash(token)])
  }

  async session(token: string | null): Promise<AuthSessionView | null> {
    if (!token) return null
    const result = await this.db.query<DbUser>(
      `select u.* from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [tokenHash(token)],
    )
    return result.rows[0] ? { user: account(result.rows[0]) } : null
  }

  async requireUser(token: string | null): Promise<AccountView> {
    const active = await this.session(token)
    if (!active) throw new ProductError('Sign in to continue.', 401)
    return active.user
  }

  async createLeague(userId: string, input: { name?: unknown }): Promise<LeagueDetailView> {
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length < 2 || name.length > 60) throw new ProductError('League names must be 2–60 characters.', 400)
    const leagueId = randomUUID()
    await this.db.transaction(async (tx) => {
      await tx.query('insert into leagues (id, name, created_by) values ($1, $2, $3)', [leagueId, name, userId])
      await tx.query("insert into league_memberships (league_id, user_id, role) values ($1, $2, 'owner')", [leagueId, userId])
    })
    return this.getLeague(userId, leagueId)
  }

  async listLeagues(userId: string): Promise<readonly LeagueSummaryView[]> {
    const result = await this.db.query<{ id: string; name: string; created_at: Date | string; role: LeagueRole; member_count: number | string }>(
      `select l.id, l.name, l.created_at, mine.role, count(all_members.user_id)::int as member_count
       from league_memberships mine join leagues l on l.id = mine.league_id
       join league_memberships all_members on all_members.league_id = l.id
       where mine.user_id = $1 group by l.id, mine.role order by l.created_at desc`,
      [userId],
    )
    return Promise.all(result.rows.map(async (row) => ({
      id: row.id, name: row.name, role: row.role, memberCount: Number(row.member_count), createdAt: iso(row.created_at),
      nextTournament: (await this.listTournaments(row.id)).find((event) => event.status !== 'completed') ?? null,
    })))
  }

  async getLeague(userId: string, leagueId: string): Promise<LeagueDetailView> {
    const league = await this.db.query<{ id: string; name: string; created_at: Date | string; role: LeagueRole }>(
      `select l.id, l.name, l.created_at, m.role from leagues l
       join league_memberships m on m.league_id = l.id where l.id = $1 and m.user_id = $2`,
      [leagueId, userId],
    )
    const row = league.rows[0]
    if (!row) throw new ProductError('League not found.', 404)
    const members = await this.db.query<DbUser & { role: LeagueRole; joined_at: Date | string; team_status: 'not-started' | 'drafting' | 'submitted' }>(
      `select u.*, m.role, m.joined_at,
       case when exists(select 1 from team_drafts td join tournaments t on t.id = td.tournament_id where t.league_id = m.league_id and td.user_id = m.user_id) then 'drafting' else 'not-started' end as team_status
       from league_memberships m join users u on u.id = m.user_id
       where m.league_id = $1 order by m.joined_at`,
      [leagueId],
    )
    return {
      id: row.id, name: row.name, createdAt: iso(row.created_at), currentUserRole: row.role,
      members: members.rows.map((member) => ({
        user: account(member), role: member.role, joinedAt: iso(member.joined_at), teamStatus: member.team_status,
      })),
      tournaments: await this.listTournaments(leagueId),
    }
  }

  async searchUsers(userId: string, query: string): Promise<readonly AccountView[]> {
    const term = query.trim()
    if (term.length < 2) return []
    const result = await this.db.query<DbUser>(
      `select * from users where id <> $1 and (username ilike $2 or display_name ilike $2)
       order by username limit 10`,
      [userId, `%${term}%`],
    )
    return result.rows.map(account)
  }

  async inviteUser(actorId: string, leagueId: string, targetUserId: string): Promise<LeagueInvitationView> {
    await this.requireLeagueAdmin(actorId, leagueId)
    const target = await this.db.query<{ id: string }>('select id from users where id = $1', [targetUserId])
    if (!target.rows.length) throw new ProductError('User not found.', 404)
    const member = await this.db.query('select 1 from league_memberships where league_id = $1 and user_id = $2', [leagueId, targetUserId])
    if (member.rows.length) throw new ProductError('That player is already in the league.', 409)
    const pending = await this.db.query('select 1 from league_invitations where league_id = $1 and invited_user_id = $2 and status = $3', [leagueId, targetUserId, 'pending'])
    if (pending.rows.length) throw new ProductError('That player already has a pending invitation.', 409)
    const id = randomUUID()
    await this.db.query(
      'insert into league_invitations (id, league_id, invited_user_id, invited_by_id) values ($1, $2, $3, $4)',
      [id, leagueId, targetUserId, actorId],
    )
    return this.getInvitation(id)
  }

  async listInvitations(userId: string): Promise<readonly LeagueInvitationView[]> {
    const result = await this.db.query<{ id: string }>(
      "select id from league_invitations where invited_user_id = $1 and status = 'pending' order by created_at desc",
      [userId],
    )
    return Promise.all(result.rows.map((row) => this.getInvitation(row.id)))
  }

  async acceptInvitation(userId: string, invitationId: string): Promise<LeagueDetailView> {
    const result = await this.db.query<{ league_id: string }>(
      "select league_id from league_invitations where id = $1 and invited_user_id = $2 and status = 'pending'",
      [invitationId, userId],
    )
    const invitation = result.rows[0]
    if (!invitation) throw new ProductError('Invitation not found.', 404)
    await this.db.transaction(async (tx) => {
      await tx.query("update league_invitations set status = 'accepted', responded_at = now() where id = $1", [invitationId])
      await tx.query("insert into league_memberships (league_id, user_id, role) values ($1, $2, 'player') on conflict do nothing", [invitation.league_id, userId])
    })
    return this.getLeague(userId, invitation.league_id)
  }

  async createTournament(actorId: string, leagueId: string, input: CreateTournamentInput): Promise<TournamentView> {
    await this.requireLeagueAdmin(actorId, leagueId)
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (name.length < 2 || name.length > 60) throw new ProductError('Tournament names must be 2–60 characters.', 400)
    const bestOf = input.bestOf === 1 || input.bestOf === 3 || input.bestOf === 5 ? input.bestOf : 3
    const teamSize = typeof input.teamSize === 'number' ? input.teamSize : 6
    if (!Number.isInteger(teamSize) || teamSize < 1 || teamSize > 6) throw new ProductError('Team size must be between 1 and 6.', 400)
    const startsAt = this.optionalDate(input.startsAt, 'start')
    const teamLockAt = this.optionalDate(input.teamLockAt, 'team lock')
    if (startsAt && teamLockAt && teamLockAt > startsAt) throw new ProductError('Team lock must be at or before the tournament start.', 400)
    const rules: TournamentRulesView = {
      gameProfileId: 'firered-gen3-v1', battleFormat: 'singles', bracket: 'single-elimination', bestOf, teamSize,
      levelPolicy: 'actual-levels', teamPreview: false, duplicateSpecies: input.duplicateSpecies === true,
      duplicateHeldItems: input.duplicateHeldItems === true, usableBagItems: false,
    }
    const id = randomUUID()
    await this.db.transaction(async (tx) => {
      await tx.query(
        `insert into tournaments (id, league_id, name, status, starts_at, team_lock_at, created_by)
         values ($1, $2, $3, 'registration-open', $4, $5, $6)`,
        [id, leagueId, name, startsAt, teamLockAt, actorId],
      )
      await tx.query(
        'insert into tournament_rule_versions (tournament_id, version, game_profile_id, definition) values ($1, 1, $2, $3::jsonb)',
        [id, rules.gameProfileId, JSON.stringify(rules)],
      )
    })
    return (await this.tournament(id))!
  }

  async requireTournamentParticipant(userId: string, tournamentId: string): Promise<TournamentView> {
    const result = await this.db.query<{ league_id: string; status: TournamentView['status'] }>(
      `select t.league_id, t.status from tournaments t join league_memberships m on m.league_id = t.league_id
       where t.id = $1 and m.user_id = $2`,
      [tournamentId, userId],
    )
    const row = result.rows[0]
    if (!row) throw new ProductError('Tournament not found.', 404)
    if (row.status !== 'planning' && row.status !== 'registration-open') throw new ProductError('Team registration is closed for this tournament.', 409)
    return (await this.tournament(tournamentId))!
  }

  async markTeamDraft(_userId: string, _tournamentId: string) {}

  async persistSaveImport(userId: string, tournamentId: string | null, saveImport: SaveImportView) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `insert into save_imports (id, user_id, tournament_id, game_profile_id, source_filename, source_sha256, parser_version, data, raw_save_stored, imported_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, false, $9) on conflict (id) do nothing`,
        [saveImport.uploadId, userId, tournamentId, saveImport.profileId, saveImport.filename, saveImport.sha256, saveImport.parserVersion, JSON.stringify(saveImport), saveImport.importedAt],
      )
      for (const pokemon of saveImport.pokemon) {
        await tx.query(
          `insert into pokemon_snapshots (save_import_id, owner_id, fingerprint, data)
           values ($1, $2, $3, $4::jsonb) on conflict (save_import_id, fingerprint) do nothing`,
          [saveImport.uploadId, userId, pokemon.fingerprint, JSON.stringify(pokemon)],
        )
      }
    })
  }

  async loadSaveImport(userId: string, tournamentId: string, uploadId: string): Promise<SaveImportView | null> {
    const result = await this.db.query<{ data: SaveImportView | string }>(
      'select data from save_imports where id = $1 and user_id = $2 and tournament_id = $3',
      [uploadId, userId, tournamentId],
    )
    return result.rows[0] ? json<SaveImportView>(result.rows[0].data) : null
  }

  async persistTeamDraft(userId: string, tournamentId: string, draft: TeamDraftView) {
    const snapshots = await this.db.query<{ id: string; fingerprint: string }>(
      'select id, fingerprint from pokemon_snapshots where save_import_id = $1 and owner_id = $2',
      [draft.uploadId, userId],
    )
    const idsByFingerprint = new Map(snapshots.rows.map((row) => [row.fingerprint, row.id]))
    const orderedIds = draft.pokemon.map((pokemon) => idsByFingerprint.get(pokemon.fingerprint))
    if (orderedIds.some((id) => !id)) throw new ProductError('A selected Pokémon snapshot could not be saved.', 500)
    await this.db.query(
      `insert into team_drafts (id, tournament_id, user_id, save_import_id, pokemon_snapshot_ids, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (tournament_id, user_id) do update set save_import_id = excluded.save_import_id,
       pokemon_snapshot_ids = excluded.pokemon_snapshot_ids, updated_at = excluded.updated_at`,
      [draft.draftId, tournamentId, userId, draft.uploadId, JSON.stringify(orderedIds), draft.savedAt],
    )
  }

  async loadTeamDraft(userId: string, tournamentId: string): Promise<TeamDraftWorkspaceView | null> {
    const result = await this.db.query<{
      id: string; save_import_id: string; pokemon_snapshot_ids: string[] | string; updated_at: Date | string; import_data: SaveImportView | string
    }>(
      `select td.id, td.save_import_id, td.pokemon_snapshot_ids, td.updated_at, si.data as import_data
       from team_drafts td join save_imports si on si.id = td.save_import_id
       where td.tournament_id = $1 and td.user_id = $2`,
      [tournamentId, userId],
    )
    const row = result.rows[0]
    if (!row) return null
    const snapshotIds = json<string[]>(row.pokemon_snapshot_ids)
    const snapshots = await this.db.query<{ id: string; data: TeamDraftView['pokemon'][number] | string }>(
      'select id, data from pokemon_snapshots where id = any($1::uuid[]) and owner_id = $2',
      [snapshotIds, userId],
    )
    const pokemonById = new Map(snapshots.rows.map((snapshot) => [snapshot.id, json<TeamDraftView['pokemon'][number]>(snapshot.data)]))
    const saveImport = json<SaveImportView>(row.import_data)
    const pokemon = snapshotIds.map((id) => pokemonById.get(id)).filter((item): item is TeamDraftView['pokemon'][number] => Boolean(item))
    return {
      saveImport,
      draft: {
        draftId: row.id, uploadId: row.save_import_id, tournamentId, profileId: saveImport.profileId,
        trainerName: saveImport.trainer.name, savedAt: iso(row.updated_at), status: 'draft', pokemon,
        normalization: { startsFullyHealed: true, movePp: 'showdown-default-maximum', sourceSaveModified: false },
      },
    }
  }

  private async createSession(user: DbUser) {
    const token = randomBytes(32).toString('base64url')
    await this.db.query(
      'insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)',
      [user.id, tokenHash(token), new Date(Date.now() + sessionLifetimeMs).toISOString()],
    )
    return { token, session: { user: account(user) } satisfies AuthSessionView }
  }

  private async requireLeagueAdmin(userId: string, leagueId: string) {
    const result = await this.db.query<{ role: LeagueRole }>(
      "select role from league_memberships where user_id = $1 and league_id = $2 and role in ('owner', 'admin')",
      [userId, leagueId],
    )
    if (!result.rows.length) throw new ProductError('Only league admins can do that.', 403)
  }

  private async getInvitation(id: string): Promise<LeagueInvitationView> {
    const result = await this.db.query<{
      id: string; league_id: string; league_name: string; status: LeagueInvitationView['status']; created_at: Date | string;
      invited_id: string; invited_username: string; invited_name: string; invited_created_at: Date | string;
      inviter_id: string; inviter_username: string; inviter_name: string; inviter_created_at: Date | string;
    }>(
      `select i.id, i.league_id, l.name as league_name, i.status, i.created_at,
       invited.id as invited_id, invited.username as invited_username, invited.display_name as invited_name, invited.created_at as invited_created_at,
       inviter.id as inviter_id, inviter.username as inviter_username, inviter.display_name as inviter_name, inviter.created_at as inviter_created_at
       from league_invitations i join leagues l on l.id = i.league_id
       join users invited on invited.id = i.invited_user_id join users inviter on inviter.id = i.invited_by_id where i.id = $1`,
      [id],
    )
    const row = result.rows[0]
    if (!row) throw new ProductError('Invitation not found.', 404)
    return {
      id: row.id, leagueId: row.league_id, leagueName: row.league_name, status: row.status, createdAt: iso(row.created_at),
      invitedUser: { id: row.invited_id, username: row.invited_username, displayName: row.invited_name, createdAt: iso(row.invited_created_at) },
      invitedBy: { id: row.inviter_id, username: row.inviter_username, displayName: row.inviter_name, createdAt: iso(row.inviter_created_at) },
    }
  }

  private async listTournaments(leagueId: string): Promise<TournamentView[]> {
    const result = await this.db.query<DbTournament>('select * from tournaments where league_id = $1 order by created_at desc', [leagueId])
    return Promise.all(result.rows.map((row) => this.tournamentView(row)))
  }

  private async tournament(id: string) {
    const result = await this.db.query<DbTournament>('select * from tournaments where id = $1', [id])
    return result.rows[0] ? this.tournamentView(result.rows[0]) : null
  }

  private async tournamentView(row: DbTournament): Promise<TournamentView> {
    const rules = await this.db.query<{ definition: TournamentRulesView | string }>(
      'select definition from tournament_rule_versions where tournament_id = $1 order by version desc limit 1',
      [row.id],
    )
    return {
      id: row.id, leagueId: row.league_id, name: row.name, status: row.status,
      startsAt: row.starts_at ? iso(row.starts_at) : null, teamLockAt: row.team_lock_at ? iso(row.team_lock_at) : null,
      rules: json<TournamentRulesView>(rules.rows[0]!.definition), createdAt: iso(row.created_at),
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

export function migrationFolder() {
  const candidates = [resolve(process.cwd(), 'drizzle'), resolve(process.cwd(), 'apps/server/drizzle')]
  const found = candidates.find(existsSync)
  if (!found) throw new Error('Could not locate the database migrations folder.')
  return found
}

class NodePostgresDatabase implements ProductDatabase {
  constructor(private readonly pool: Pool) {}

  async query<T>(statement: string, parameters: unknown[] = []) {
    const result = await this.pool.query(statement, parameters)
    return { rows: result.rows as T[] }
  }

  async transaction<T>(work: (database: SqlExecutor) => Promise<T>) {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const result = await work({
        query: async <TRow>(statement: string, parameters: unknown[] = []) => {
          const queryResult = await client.query(statement, parameters)
          return { rows: queryResult.rows as TRow[] }
        },
      })
      await client.query('commit')
      return result
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  }

  async close() {
    await this.pool.end()
  }
}

export async function seedProfiles(database: SqlExecutor) {
  for (const profile of publicProfiles) {
    await database.query(
      `insert into game_profiles (id, version, name, player_enabled, definition)
       values ($1, $2, $3, true, $4::jsonb) on conflict (id) do nothing`,
      [profile.id, profile.version, profile.name, JSON.stringify(profile)],
    )
  }
}

export async function createDurableProductService() {
  const [{ drizzle }, { migrate }] = await Promise.all([
    import('drizzle-orm/node-postgres'),
    import('drizzle-orm/node-postgres/migrator'),
  ])
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://pmb:pmb@127.0.0.1:5432/pmb',
    max: 10,
  })
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationFolder() })
    const database = new NodePostgresDatabase(pool)
    await seedProfiles(database)
    return new DurableProductService(database)
  } catch (error) {
    await pool.end()
    throw error
  }
}
