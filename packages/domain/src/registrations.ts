import type { ImportedPokemon, SaveImportView } from './imports.js'

export type TeamRegistrationRequest = {
  readonly uploadId: string
  readonly tournamentId?: string
  readonly pokemonFingerprints: readonly string[]
}

export type RegisteredTeamView = {
  readonly registrationId: string
  readonly uploadId: string
  readonly tournamentId: string | null
  readonly profileId: 'firered-gen3-v1'
  readonly player: 'p1'
  readonly trainerName: string
  readonly lockedAt: string
  readonly status: 'locked'
  readonly pokemon: readonly ImportedPokemon[]
  readonly normalization: {
    readonly startsFullyHealed: true
    readonly movePp: 'showdown-default-maximum'
    readonly sourceSaveModified: false
  }
}

export type TeamDraftView = {
  readonly draftId: string
  readonly uploadId: string
  readonly tournamentId: string
  readonly profileId: 'firered-gen3-v1'
  readonly trainerName: string
  readonly savedAt: string
  readonly status: 'draft'
  readonly pokemon: readonly ImportedPokemon[]
  readonly normalization: RegisteredTeamView['normalization']
}

export type TeamDraftWorkspaceView = {
  readonly draft: TeamDraftView
  readonly saveImport: SaveImportView
}
