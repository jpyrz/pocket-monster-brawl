import { createHash, randomBytes, randomInt, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { Pool } from 'pg'
import {
  publicProfiles,
  trainerSpriteIds,
  type AccountView,
  type AuthSessionView,
  type BoxPokemonView,
  type BoxTeamDraftWorkspaceView,
  type DemoBattleChoice,
  type DemoPlayerId,
  type ImportedPokemon,
  type LeagueDetailView,
  type LeagueInvitationView,
  type LeagueRole,
  type LeagueSummaryView,
  type LockedTeamView,
  type PokemonBoxView,
  type SaveImportView,
  type TeamDraftView,
  type TeamDraftWorkspaceView,
  type TournamentRulesView,
  type TournamentMatchView,
  type TournamentView,
  type TrainerCardView,
  type TrainerSpriteId,
} from '@pmb/domain'
import { ProductError, type CreateTournamentInput } from './LocalProductService.js'
import { mapAndValidateImportedTeam, TeamAdapterError } from '../registrations/ShowdownTeamAdapter.js'

const scrypt = promisify(scryptCallback)
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000

type DbUser = { id: string; username: string; display_name: string; password_hash: string; created_at: Date | string }
type DbTournament = { id: string; league_id: string; name: string; status: TournamentView['status']; starts_at: Date | string | null; team_lock_at: Date | string | null; created_at: Date | string }
type DbBoxPokemon = {
  snapshot_id: string
  save_import_id: string
  pokemon_data: ImportedPokemon | string
  import_data: SaveImportView | string
}
type SqlResult<T> = { rows: T[] }
export type SqlExecutor = { query<T>(statement: string, parameters?: unknown[]): Promise<SqlResult<T>> }
export type ProductDatabase = SqlExecutor & { transaction<T>(work: (database: SqlExecutor) => Promise<T>): Promise<T>; close(): Promise<void> }
export type MatchBattleSetup = {
  battleId: string
  seriesId: string
  tournamentId: string
  status: 'active' | 'completed'
  seed: [number, number, number, number]
  engineVersion: string
  formatId: 'gen3customgame'
  player: DemoPlayerId
  playerOne: { id: string; name: string; trainerSprite: TrainerSpriteId; packedTeam: string; registrationId: string }
  playerTwo: { id: string; name: string; trainerSprite: TrainerSpriteId; packedTeam: string; registrationId: string }
  decisions: Array<{ userId: string; player: DemoPlayerId; choice: DemoBattleChoice }>
}
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

function boxPokemon(row: DbBoxPokemon): BoxPokemonView {
  const imported = json<SaveImportView>(row.import_data)
  return {
    snapshotId: row.snapshot_id,
    uploadId: row.save_import_id,
    profileId: imported.profileId,
    game: imported.game,
    gameVersion: imported.gameVersion,
    filename: imported.filename,
    importedAt: imported.importedAt,
    pokemon: json<ImportedPokemon>(row.pokemon_data),
  }
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

  async listPokemonBox(userId: string, profileId?: string): Promise<PokemonBoxView> {
    const parameters = profileId ? [userId, profileId] : [userId]
    const profileClause = profileId ? 'and si.game_profile_id = $2' : ''
    const [importResult, pokemonResult] = await Promise.all([
      this.db.query<{ data: SaveImportView | string }>(
        `select distinct on (si.source_sha256) si.data
         from save_imports si where si.user_id = $1 ${profileClause}
         order by si.source_sha256, si.imported_at desc`,
        parameters,
      ),
      this.db.query<DbBoxPokemon>(
        `select distinct on (ps.fingerprint) ps.id as snapshot_id, ps.save_import_id,
         ps.data as pokemon_data, si.data as import_data
         from pokemon_snapshots ps join save_imports si on si.id = ps.save_import_id
         where ps.owner_id = $1 ${profileClause}
         order by ps.fingerprint, si.imported_at desc, ps.created_at desc`,
        parameters,
      ),
    ])
    const imports = importResult.rows
      .map((row) => json<SaveImportView>(row.data))
      .sort((left, right) => right.importedAt.localeCompare(left.importedAt))
      .map((item) => ({
        uploadId: item.uploadId,
        profileId: item.profileId,
        game: item.game,
        gameVersion: item.gameVersion,
        filename: item.filename,
        importedAt: item.importedAt,
        trainerName: item.trainer.name,
        pokemonCount: item.pokemon.length,
      }))
    const pokemon = pokemonResult.rows.map(boxPokemon).sort((left, right) => {
      const importOrder = right.importedAt.localeCompare(left.importedAt)
      if (importOrder) return importOrder
      if (left.pokemon.source.kind !== right.pokemon.source.kind) return left.pokemon.source.kind === 'party' ? -1 : 1
      return (left.pokemon.source.box ?? -1) - (right.pokemon.source.box ?? -1) || left.pokemon.source.slot - right.pokemon.source.slot
    })
    return { imports, pokemon }
  }

  async getTrainerCard(userId: string): Promise<TrainerCardView> {
    const [userResult, profileResult, leagueResult, cupResult, recordResult] = await Promise.all([
      this.db.query<DbUser>('select * from users where id = $1', [userId]),
      this.db.query<{ trainer_sprite: TrainerSpriteId; partner_pokemon_snapshot_id: string | null }>(
        'select trainer_sprite, partner_pokemon_snapshot_id from trainer_profiles where user_id = $1', [userId],
      ),
      this.db.query<{ count: number | string }>('select count(*)::int as count from league_memberships where user_id = $1', [userId]),
      this.db.query<{ count: number | string }>(
        `select count(distinct t.id)::int as count from tournaments t
         join league_memberships m on m.league_id = t.league_id where m.user_id = $1`, [userId],
      ),
      this.db.query<{ wins: number | string; losses: number | string }>(
        `select
         count(*) filter (where winner_id = $1)::int as wins,
         count(*) filter (where winner_id is not null and winner_id <> $1)::int as losses
         from match_series where status = 'completed' and (player_one_id = $1 or player_two_id = $1)`, [userId],
      ),
    ])
    const user = userResult.rows[0]
    if (!user) throw new ProductError('Trainer not found.', 404)
    const profile = profileResult.rows[0]
    let partner: BoxPokemonView | null = null
    if (profile?.partner_pokemon_snapshot_id) {
      const partnerResult = await this.db.query<DbBoxPokemon>(
        `select ps.id as snapshot_id, ps.save_import_id, ps.data as pokemon_data, si.data as import_data
         from pokemon_snapshots ps join save_imports si on si.id = ps.save_import_id
         where ps.id = $1 and ps.owner_id = $2`,
        [profile.partner_pokemon_snapshot_id, userId],
      )
      if (partnerResult.rows[0]) partner = boxPokemon(partnerResult.rows[0])
    }
    const record = recordResult.rows[0]
    return {
      user: account(user),
      trainerSprite: profile?.trainer_sprite ?? 'red',
      partner,
      stats: {
        leagues: Number(leagueResult.rows[0]?.count ?? 0),
        cups: Number(cupResult.rows[0]?.count ?? 0),
        wins: Number(record?.wins ?? 0),
        losses: Number(record?.losses ?? 0),
      },
    }
  }

  async updateTrainerCard(userId: string, input: { trainerSprite?: unknown; partnerPokemonSnapshotId?: unknown }): Promise<TrainerCardView> {
    const current = await this.db.query<{ trainer_sprite: TrainerSpriteId; partner_pokemon_snapshot_id: string | null }>(
      'select trainer_sprite, partner_pokemon_snapshot_id from trainer_profiles where user_id = $1', [userId],
    )
    const currentProfile = current.rows[0]
    let trainerSprite = currentProfile?.trainer_sprite ?? 'red'
    if (input.trainerSprite !== undefined) {
      if (typeof input.trainerSprite !== 'string' || !trainerSpriteIds.includes(input.trainerSprite as TrainerSpriteId)) {
        throw new ProductError('Choose a supported trainer sprite.', 400)
      }
      trainerSprite = input.trainerSprite as TrainerSpriteId
    }
    let partnerPokemonSnapshotId = currentProfile?.partner_pokemon_snapshot_id ?? null
    if (input.partnerPokemonSnapshotId !== undefined) {
      if (input.partnerPokemonSnapshotId === null) {
        partnerPokemonSnapshotId = null
      } else {
        if (typeof input.partnerPokemonSnapshotId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.partnerPokemonSnapshotId)) {
          throw new ProductError('Choose a Pokémon from your Box.', 400)
        }
        const owned = await this.db.query('select 1 from pokemon_snapshots where id = $1 and owner_id = $2', [input.partnerPokemonSnapshotId, userId])
        if (!owned.rows.length) throw new ProductError('That Pokémon is not in your Box.', 404)
        partnerPokemonSnapshotId = input.partnerPokemonSnapshotId
      }
    }
    await this.db.query(
      `insert into trainer_profiles (user_id, trainer_sprite, partner_pokemon_snapshot_id, updated_at)
       values ($1, $2, $3, now()) on conflict (user_id) do update set
       trainer_sprite = excluded.trainer_sprite,
       partner_pokemon_snapshot_id = excluded.partner_pokemon_snapshot_id,
       updated_at = now()`,
      [userId, trainerSprite, partnerPokemonSnapshotId],
    )
    return this.getTrainerCard(userId)
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
       case
       when exists(select 1 from registered_team_versions r join tournaments t on t.id = r.tournament_id where t.league_id = m.league_id and r.user_id = m.user_id) then 'submitted'
       when exists(select 1 from team_drafts td join tournaments t on t.id = td.tournament_id where t.league_id = m.league_id and td.user_id = m.user_id) then 'drafting'
       else 'not-started' end as team_status
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
    const tournament = await this.requireTournamentMember(userId, tournamentId)
    if (tournament.status !== 'planning' && tournament.status !== 'registration-open') throw new ProductError('Team registration is closed for this tournament.', 409)
    return tournament
  }

  async requireTournamentMember(userId: string, tournamentId: string): Promise<TournamentView> {
    const result = await this.db.query<{ league_id: string; status: TournamentView['status'] }>(
      `select t.league_id, t.status from tournaments t join league_memberships m on m.league_id = t.league_id
       where t.id = $1 and m.user_id = $2`,
      [tournamentId, userId],
    )
    const row = result.rows[0]
    if (!row) throw new ProductError('Tournament not found.', 404)
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

  async loadOwnedSaveImport(userId: string, uploadId: string): Promise<SaveImportView | null> {
    const result = await this.db.query<{ data: SaveImportView | string }>(
      'select data from save_imports where id = $1 and user_id = $2', [uploadId, userId],
    )
    return result.rows[0] ? json<SaveImportView>(result.rows[0].data) : null
  }

  async saveBoxTeamDraft(userId: string, tournamentId: string, snapshotIds: readonly string[]): Promise<BoxTeamDraftWorkspaceView> {
    const tournament = await this.requireTournamentParticipant(userId, tournamentId)
    if (snapshotIds.length < 1 || snapshotIds.length > tournament.rules.teamSize) {
      throw new ProductError(`Choose between 1 and ${tournament.rules.teamSize} Pokémon.`, 400)
    }
    if (new Set(snapshotIds).size !== snapshotIds.length || snapshotIds.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) {
      throw new ProductError('Choose valid, non-duplicate Pokémon from your Box.', 400)
    }
    const locked = await this.db.query(
      'select 1 from registered_team_versions where tournament_id = $1 and user_id = $2 limit 1', [tournamentId, userId],
    )
    if (locked.rows.length) throw new ProductError('This team is locked and can no longer be edited.', 409)
    const result = await this.db.query<DbBoxPokemon>(
      `select ps.id as snapshot_id, ps.save_import_id, ps.data as pokemon_data, si.data as import_data
       from pokemon_snapshots ps join save_imports si on si.id = ps.save_import_id
       where ps.id = any($1::uuid[]) and ps.owner_id = $2 and si.game_profile_id = $3`,
      [snapshotIds, userId, tournament.rules.gameProfileId],
    )
    const byId = new Map(result.rows.map((row) => [row.snapshot_id, row]))
    const ordered = snapshotIds.map((id) => byId.get(id))
    if (ordered.some((row) => !row)) throw new ProductError('One or more Pokémon are not eligible for this tournament.', 422)
    const rows = ordered as DbBoxPokemon[]
    const pokemon = rows.map((row) => json<ImportedPokemon>(row.pokemon_data))
    if (pokemon.some((item) => item.egg || !item.entityValid || !item.legalityValid || !item.moves.length)) {
      throw new ProductError('Eggs, invalid Pokémon, and Pokémon without moves cannot join a team.', 422)
    }
    const existingDraft = await this.db.query<{ id: string }>(
      'select id from team_drafts where tournament_id = $1 and user_id = $2', [tournamentId, userId],
    )
    const draftId = existingDraft.rows[0]?.id ?? randomUUID()
    const savedAt = new Date().toISOString()
    const primaryImport = json<SaveImportView>(rows[0]!.import_data)
    await this.db.query(
      `insert into team_drafts (id, tournament_id, user_id, save_import_id, pokemon_snapshot_ids, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)
       on conflict (tournament_id, user_id) do update set save_import_id = excluded.save_import_id,
       pokemon_snapshot_ids = excluded.pokemon_snapshot_ids, updated_at = excluded.updated_at`,
      [draftId, tournamentId, userId, rows[0]!.save_import_id, JSON.stringify(snapshotIds), savedAt],
    )
    await this.markTeamDraft(userId, tournamentId)
    const box = await this.listPokemonBox(userId, tournament.rules.gameProfileId)
    return {
      tournament,
      eligiblePokemon: box.pokemon,
      draft: {
        draftId,
        uploadId: rows[0]!.save_import_id,
        tournamentId,
        profileId: primaryImport.profileId,
        trainerName: primaryImport.trainer.name,
        savedAt,
        status: 'draft',
        pokemon,
        normalization: { startsFullyHealed: true, movePp: 'showdown-default-maximum', sourceSaveModified: false },
      },
      draftPokemonSnapshotIds: [...snapshotIds],
    }
  }

  async getBoxTeamDraftWorkspace(userId: string, tournamentId: string): Promise<BoxTeamDraftWorkspaceView> {
    const tournament = await this.requireTournamentMember(userId, tournamentId)
    const [box, draft, row] = await Promise.all([
      this.listPokemonBox(userId, tournament.rules.gameProfileId),
      this.loadTeamDraft(userId, tournamentId),
      this.db.query<{ pokemon_snapshot_ids: string[] | string }>(
        'select pokemon_snapshot_ids from team_drafts where tournament_id = $1 and user_id = $2', [tournamentId, userId],
      ),
    ])
    return {
      tournament,
      eligiblePokemon: box.pokemon,
      draft: draft?.draft ?? null,
      draftPokemonSnapshotIds: row.rows[0] ? json<string[]>(row.rows[0].pokemon_snapshot_ids) : [],
    }
  }

  async persistTeamDraft(userId: string, tournamentId: string, draft: TeamDraftView) {
    const locked = await this.db.query(
      'select 1 from registered_team_versions where tournament_id = $1 and user_id = $2 limit 1',
      [tournamentId, userId],
    )
    if (locked.rows.length) throw new ProductError('This team is locked and can no longer be edited.', 409)
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

  async getLockedTeam(userId: string, tournamentId: string): Promise<LockedTeamView | null> {
    const result = await this.db.query<{
      id: string; locked_at: Date | string; pokemon_count: number | string
    }>(
      `select r.id, r.locked_at, jsonb_array_length(d.pokemon_snapshot_ids)::int as pokemon_count
       from registered_team_versions r join team_drafts d on d.id = r.source_draft_id
       where r.tournament_id = $1 and r.user_id = $2 order by r.version desc limit 1`,
      [tournamentId, userId],
    )
    const row = result.rows[0]
    return row ? {
      registrationId: row.id, tournamentId, lockedAt: iso(row.locked_at),
      pokemonCount: Number(row.pokemon_count), status: 'locked',
    } : null
  }

  async lockTeam(userId: string, tournamentId: string): Promise<LockedTeamView> {
    await this.requireTournamentParticipant(userId, tournamentId)
    const existing = await this.getLockedTeam(userId, tournamentId)
    if (existing) return existing
    const workspace = await this.loadTeamDraft(userId, tournamentId)
    if (!workspace) throw new ProductError('Save a team draft before locking it.', 409)
    const tournament = await this.tournament(tournamentId)
    if (!tournament) throw new ProductError('Tournament not found.', 404)
    if (workspace.draft.pokemon.length < 1 || workspace.draft.pokemon.length > tournament.rules.teamSize) {
      throw new ProductError(`Choose between 1 and ${tournament.rules.teamSize} Pokémon before locking your team.`, 409)
    }
    let packedTeam: string
    try {
      packedTeam = mapAndValidateImportedTeam(workspace.draft.pokemon).packed
    } catch (error) {
      if (error instanceof TeamAdapterError) throw new ProductError(error.message, 422)
      throw error
    }
    const registrationId = randomUUID()
    const lockedAt = new Date().toISOString()
    const commitment = createHash('sha256').update(packedTeam).digest('hex')
    return this.db.transaction(async (tx) => {
      await tx.query('select id from tournaments where id = $1 for update', [tournamentId])
      const locked = await tx.query<{ id: string; locked_at: Date | string; pokemon_count: number | string }>(
        `select r.id, r.locked_at, jsonb_array_length(d.pokemon_snapshot_ids)::int as pokemon_count
         from registered_team_versions r join team_drafts d on d.id = r.source_draft_id
         where r.tournament_id = $1 and r.user_id = $2 order by r.version desc limit 1`,
        [tournamentId, userId],
      )
      const alreadyLocked = locked.rows[0]
      if (alreadyLocked) {
        return {
          registrationId: alreadyLocked.id, tournamentId, lockedAt: iso(alreadyLocked.locked_at),
          pokemonCount: Number(alreadyLocked.pokemon_count), status: 'locked' as const,
        }
      }
      await tx.query(
        `insert into registered_team_versions
         (id, tournament_id, user_id, version, source_draft_id, packed_showdown_team, public_commitment, locked_at)
         values ($1, $2, $3, 1, $4, $5, $6, $7)`,
        [registrationId, tournamentId, userId, workspace.draft.draftId, packedTeam, commitment, lockedAt],
      )
      await tx.query(
        `insert into tournament_entries (tournament_id, user_id, registered_team_version_id, status)
         values ($1, $2, $3, 'locked')
         on conflict (tournament_id, user_id) do update set
        registered_team_version_id = excluded.registered_team_version_id, status = 'locked'`,
        [tournamentId, userId, registrationId],
      )
      return {
        registrationId, tournamentId, lockedAt,
        pokemonCount: workspace.draft.pokemon.length, status: 'locked' as const,
      }
    })
  }

  async startTwoPlayerTournament(actorId: string, tournamentId: string, engineVersion: string): Promise<TournamentMatchView> {
    const tournamentResult = await this.db.query<{ league_id: string; status: TournamentView['status'] }>(
      'select league_id, status from tournaments where id = $1', [tournamentId],
    )
    const tournament = tournamentResult.rows[0]
    if (!tournament) throw new ProductError('Tournament not found.', 404)
    await this.requireLeagueAdmin(actorId, tournament.league_id)
    const existing = await this.getTournamentMatch(actorId, tournamentId)
    if (existing) return existing
    const entrants = await this.db.query<{ user_id: string; registered_team_version_id: string | null }>(
      `select e.user_id, e.registered_team_version_id from tournament_entries e
       join league_memberships m on m.league_id = $2 and m.user_id = e.user_id
       where e.tournament_id = $1 and e.registered_team_version_id is not null
       order by m.joined_at, m.user_id`,
      [tournamentId, tournament.league_id],
    )
    if (entrants.rows.length !== 2) throw new ProductError('The first playable tournament requires exactly two locked teams.', 409)
    const seriesId = randomUUID()
    const battleId = randomUUID()
    const seed = battleSeed()
    await this.db.transaction(async (tx) => {
      const lockedTournament = await tx.query<{ status: TournamentView['status'] }>(
        'select status from tournaments where id = $1 for update', [tournamentId],
      )
      const existingSeries = await tx.query('select 1 from match_series where tournament_id = $1 limit 1', [tournamentId])
      if (existingSeries.rows.length) return
      if (lockedTournament.rows[0]?.status !== 'registration-open' && lockedTournament.rows[0]?.status !== 'teams-locked') {
        throw new ProductError('This tournament cannot be started.', 409)
      }
      await tx.query("update tournaments set status = 'in-progress' where id = $1", [tournamentId])
      await tx.query('update tournament_rule_versions set frozen_at = now() where tournament_id = $1 and frozen_at is null', [tournamentId])
      await tx.query(
        `insert into match_series (id, tournament_id, round, position, player_one_id, player_two_id, status)
         values ($1, $2, 1, 1, $3, $4, 'in-progress')`,
        [seriesId, tournamentId, entrants.rows[0]!.user_id, entrants.rows[1]!.user_id],
      )
      await tx.query(
        `insert into battles (id, series_id, game_number, seed, engine_version, format_id, status, started_at)
         values ($1, $2, 1, $3::jsonb, $4, 'gen3customgame', 'active', now())`,
        [battleId, seriesId, JSON.stringify(seed), engineVersion],
      )
    })
    return (await this.getTournamentMatch(actorId, tournamentId))!
  }

  async getTournamentMatch(userId: string, tournamentId: string): Promise<TournamentMatchView | null> {
    const seriesResult = await this.db.query<{
      id: string; player_one_id: string; player_two_id: string; winner_id: string | null; status: string
    }>(
      `select * from match_series where tournament_id = $1 and (player_one_id = $2 or player_two_id = $2)
       order by round desc, position limit 1`,
      [tournamentId, userId],
    )
    const series = seriesResult.rows[0]
    if (!series) return null
    const opponentId = series.player_one_id === userId ? series.player_two_id : series.player_one_id
    const [battleResult, scoreResult, opponentResult, winnerResult, rulesResult] = await Promise.all([
      this.db.query<{ id: string; game_number: number; status: string }>(
        'select id, game_number, status from battles where series_id = $1 order by game_number desc limit 1', [series.id],
      ),
      this.db.query<{ winner_id: string; wins: number | string }>(
        'select winner_id, count(*)::int as wins from battles where series_id = $1 and winner_id is not null group by winner_id', [series.id],
      ),
      this.db.query<DbUser>('select * from users where id = $1', [opponentId]),
      series.winner_id ? this.db.query<DbUser>('select * from users where id = $1', [series.winner_id]) : Promise.resolve({ rows: [] as DbUser[] }),
      this.db.query<{ definition: TournamentRulesView | string }>(
        'select definition from tournament_rule_versions where tournament_id = $1 order by version desc limit 1', [tournamentId],
      ),
    ])
    const battle = battleResult.rows[0]
    const opponent = opponentResult.rows[0]
    if (!battle || !opponent) return null
    const wins = new Map(scoreResult.rows.map((row) => [row.winner_id, Number(row.wins)]))
    const rules = json<TournamentRulesView>(rulesResult.rows[0]!.definition)
    return {
      battleId: battle.id, seriesId: series.id, tournamentId,
      status: series.status === 'completed' ? 'completed' : 'active', gameNumber: battle.game_number,
      bestOf: rules.bestOf, playerWins: wins.get(userId) ?? 0, opponentWins: wins.get(opponentId) ?? 0,
      opponent: account(opponent), winner: winnerResult.rows[0] ? account(winnerResult.rows[0]) : null,
    }
  }

  async getMatchBattleSetup(userId: string, battleId: string): Promise<MatchBattleSetup> {
    const result = await this.db.query<{
      battle_id: string; series_id: string; tournament_id: string; battle_status: string; seed: [number, number, number, number] | string;
      engine_version: string; format_id: string; player_one_id: string; player_two_id: string;
      p1_name: string; p2_name: string; p1_trainer_sprite: TrainerSpriteId; p2_trainer_sprite: TrainerSpriteId;
      p1_team: string; p2_team: string; p1_registration: string; p2_registration: string;
    }>(
      `select b.id as battle_id, b.series_id, s.tournament_id, b.status as battle_status, b.seed,
       b.engine_version, b.format_id, s.player_one_id, s.player_two_id,
       p1.display_name as p1_name, p2.display_name as p2_name,
       coalesce(tp1.trainer_sprite, 'red') as p1_trainer_sprite,
       coalesce(tp2.trainer_sprite, 'red') as p2_trainer_sprite,
       r1.packed_showdown_team as p1_team, r2.packed_showdown_team as p2_team,
       r1.id as p1_registration, r2.id as p2_registration
       from battles b join match_series s on s.id = b.series_id
       join users p1 on p1.id = s.player_one_id join users p2 on p2.id = s.player_two_id
       left join trainer_profiles tp1 on tp1.user_id = s.player_one_id
       left join trainer_profiles tp2 on tp2.user_id = s.player_two_id
       join tournament_entries e1 on e1.tournament_id = s.tournament_id and e1.user_id = s.player_one_id
       join tournament_entries e2 on e2.tournament_id = s.tournament_id and e2.user_id = s.player_two_id
       join registered_team_versions r1 on r1.id = e1.registered_team_version_id
       join registered_team_versions r2 on r2.id = e2.registered_team_version_id
       where b.id = $1 and ($2 = s.player_one_id or $2 = s.player_two_id)`,
      [battleId, userId],
    )
    const row = result.rows[0]
    if (!row) throw new ProductError('Match not found.', 404)
    const decisions = await this.db.query<{
      user_id: string; player_slot: DemoPlayerId; request_id: number; idempotency_key: string; choice_type: 'move' | 'switch'; choice_slot: number
    }>('select * from battle_decisions where battle_id = $1 order by created_at, id', [battleId])
    return {
      battleId: row.battle_id, seriesId: row.series_id, tournamentId: row.tournament_id,
      status: row.battle_status === 'completed' ? 'completed' : 'active',
      seed: json<[number, number, number, number]>(row.seed), engineVersion: row.engine_version,
      formatId: 'gen3customgame', player: row.player_one_id === userId ? 'p1' : 'p2',
      playerOne: { id: row.player_one_id, name: row.p1_name, trainerSprite: row.p1_trainer_sprite, packedTeam: row.p1_team, registrationId: row.p1_registration },
      playerTwo: { id: row.player_two_id, name: row.p2_name, trainerSprite: row.p2_trainer_sprite, packedTeam: row.p2_team, registrationId: row.p2_registration },
      decisions: decisions.rows.map((decision) => ({
        userId: decision.user_id, player: decision.player_slot,
        choice: { requestId: decision.request_id, idempotencyKey: decision.idempotency_key, type: decision.choice_type, slot: decision.choice_slot },
      })),
    }
  }

  async journalBattleChoice(userId: string, battleId: string, player: DemoPlayerId, choice: DemoBattleChoice) {
    const inserted = await this.db.query<{ id: string }>(
      `insert into battle_decisions (battle_id, user_id, player_slot, request_id, idempotency_key, choice_type, choice_slot)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id`,
      [battleId, userId, player, choice.requestId, choice.idempotencyKey, choice.type, choice.slot],
    )
    if (inserted.rows.length) return
    const existing = await this.db.query<{ user_id: string; idempotency_key: string; choice_type: string; choice_slot: number }>(
      'select user_id, idempotency_key, choice_type, choice_slot from battle_decisions where battle_id = $1 and player_slot = $2 and request_id = $3',
      [battleId, player, choice.requestId],
    )
    const row = existing.rows[0]
    if (!row || row.user_id !== userId || row.idempotency_key !== choice.idempotencyKey || row.choice_type !== choice.type || row.choice_slot !== choice.slot) {
      throw new ProductError('A different choice was already accepted for this turn.', 409)
    }
  }

  async completeBattle(battleId: string, winnerId: string, showdownLog: string, engineVersion: string) {
    await this.db.transaction(async (tx) => {
      const battleResult = await tx.query<{ series_id: string; game_number: number; status: string }>(
        'select series_id, game_number, status from battles where id = $1 for update', [battleId],
      )
      const battle = battleResult.rows[0]
      if (!battle || battle.status === 'completed') return
      await tx.query(
        "update battles set status = 'completed', winner_id = $2, showdown_log = $3, completed_at = now() where id = $1",
        [battleId, winnerId, showdownLog],
      )
      const seriesResult = await tx.query<{ tournament_id: string }>('select tournament_id from match_series where id = $1', [battle.series_id])
      const tournamentId = seriesResult.rows[0]!.tournament_id
      const rulesResult = await tx.query<{ definition: TournamentRulesView | string }>(
        'select definition from tournament_rule_versions where tournament_id = $1 order by version desc limit 1', [tournamentId],
      )
      const rules = json<TournamentRulesView>(rulesResult.rows[0]!.definition)
      const winsResult = await tx.query<{ wins: number | string }>(
        'select count(*)::int as wins from battles where series_id = $1 and winner_id = $2', [battle.series_id, winnerId],
      )
      if (Number(winsResult.rows[0]?.wins ?? 0) >= Math.ceil(rules.bestOf / 2)) {
        await tx.query("update match_series set status = 'completed', winner_id = $2 where id = $1", [battle.series_id, winnerId])
        await tx.query("update tournaments set status = 'completed' where id = $1", [tournamentId])
        return
      }
      await tx.query(
        `insert into battles (series_id, game_number, seed, engine_version, format_id, status, started_at)
         values ($1, $2, $3::jsonb, $4, 'gen3customgame', 'active', now())`,
        [battle.series_id, battle.game_number + 1, JSON.stringify(battleSeed()), engineVersion],
      )
    })
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

function battleSeed(): [number, number, number, number] {
  return [randomInt(0x10000), randomInt(0x10000), randomInt(0x10000), randomInt(0x10000)]
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
