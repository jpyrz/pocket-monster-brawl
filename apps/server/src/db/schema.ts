import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const gameProfiles = pgTable('game_profiles', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  name: text('name').notNull(),
  playerEnabled: boolean('player_enabled').notNull().default(false),
  definition: jsonb('definition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('game_profile_id_version').on(table.id, table.version)])

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const seasonRuleVersions = pgTable('season_rule_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id').notNull().references(() => seasons.id),
  version: integer('version').notNull(),
  gameProfileId: text('game_profile_id').notNull().references(() => gameProfiles.id),
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
  definition: jsonb('definition').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('season_rule_version').on(table.seasonId, table.version)])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const leagueMemberships = pgTable('league_memberships', {
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull().default('player'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.leagueId, table.userId] })])

export const leagueInvitations = pgTable('league_invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  invitedUserId: uuid('invited_user_id').notNull().references(() => users.id),
  invitedById: uuid('invited_by_id').notNull().references(() => users.id),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
})

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  name: text('name').notNull(),
  status: text('status').notNull().default('planning'),
  startsAt: timestamp('starts_at', { withTimezone: true }),
  teamLockAt: timestamp('team_lock_at', { withTimezone: true }),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tournamentRuleVersions = pgTable('tournament_rule_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id),
  version: integer('version').notNull(),
  gameProfileId: text('game_profile_id').notNull().references(() => gameProfiles.id),
  definition: jsonb('definition').notNull(),
  frozenAt: timestamp('frozen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('tournament_rule_version').on(table.tournamentId, table.version)])

export const saveImports = pgTable('save_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tournamentId: uuid('tournament_id').references(() => tournaments.id),
  gameProfileId: text('game_profile_id').notNull().references(() => gameProfiles.id),
  sourceFilename: text('source_filename').notNull(),
  sourceSha256: text('source_sha256').notNull(),
  parserVersion: text('parser_version').notNull(),
  data: jsonb('data').notNull(),
  rawSaveStored: boolean('raw_save_stored').notNull().default(false),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pokemonSnapshots = pgTable('pokemon_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  saveImportId: uuid('save_import_id').notNull().references(() => saveImports.id),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  fingerprint: text('fingerprint').notNull(),
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('pokemon_snapshot_import_fingerprint').on(table.saveImportId, table.fingerprint)])

export const trainerProfiles = pgTable('trainer_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id),
  trainerSprite: text('trainer_sprite').notNull().default('red'),
  partnerPokemonSnapshotId: uuid('partner_pokemon_snapshot_id').references(() => pokemonSnapshots.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const teamDrafts = pgTable('team_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  saveImportId: uuid('save_import_id').notNull().references(() => saveImports.id),
  pokemonSnapshotIds: jsonb('pokemon_snapshot_ids').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('team_draft_tournament_user').on(table.tournamentId, table.userId)])

export const registeredTeamVersions = pgTable('registered_team_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  version: integer('version').notNull(),
  sourceDraftId: uuid('source_draft_id').notNull().references(() => teamDrafts.id),
  packedShowdownTeam: text('packed_showdown_team').notNull(),
  publicCommitment: text('public_commitment').notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true }).notNull(),
}, (table) => [uniqueIndex('registered_team_tournament_user_version').on(table.tournamentId, table.userId, table.version)])

export const tournamentEntries = pgTable('tournament_entries', {
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  seed: integer('seed'),
  registeredTeamVersionId: uuid('registered_team_version_id').references(() => registeredTeamVersions.id),
  status: text('status').notNull().default('entered'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.tournamentId, table.userId] })])

export const matchSeries = pgTable('match_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  tournamentId: uuid('tournament_id').notNull().references(() => tournaments.id),
  round: integer('round').notNull(),
  position: integer('position').notNull(),
  playerOneId: uuid('player_one_id').references(() => users.id),
  playerTwoId: uuid('player_two_id').references(() => users.id),
  winnerId: uuid('winner_id').references(() => users.id),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('match_series_bracket_position').on(table.tournamentId, table.round, table.position)])

export const battles = pgTable('battles', {
  id: uuid('id').primaryKey().defaultRandom(),
  seriesId: uuid('series_id').notNull().references(() => matchSeries.id),
  gameNumber: integer('game_number').notNull(),
  winnerId: uuid('winner_id').references(() => users.id),
  showdownLog: text('showdown_log'),
  seed: jsonb('seed').notNull(),
  engineVersion: text('engine_version').notNull(),
  formatId: text('format_id').notNull().default('gen3customgame'),
  status: text('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [uniqueIndex('battle_series_game').on(table.seriesId, table.gameNumber)])

export const battleDecisions = pgTable('battle_decisions', {
  id: uuid('id').primaryKey().defaultRandom(),
  battleId: uuid('battle_id').notNull().references(() => battles.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  playerSlot: text('player_slot').notNull(),
  requestId: integer('request_id').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  choiceType: text('choice_type').notNull(),
  choiceSlot: integer('choice_slot').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('battle_decision_idempotency').on(table.battleId, table.userId, table.idempotencyKey),
  uniqueIndex('battle_decision_request').on(table.battleId, table.playerSlot, table.requestId),
])
