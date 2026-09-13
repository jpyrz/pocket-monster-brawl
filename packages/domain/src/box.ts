import type { ImportedPokemon } from './imports.js'
import type { AccountView, TournamentView } from './leagues.js'
import type { TeamDraftView } from './registrations.js'

export const trainerSpriteIds = ['red', 'leaf-gen3', 'ethan', 'lyra', 'brendan', 'may', 'lucas', 'dawn'] as const
export type TrainerSpriteId = typeof trainerSpriteIds[number]

export type BoxImportView = {
  readonly uploadId: string
  readonly profileId: string
  readonly game: string
  readonly gameVersion: string
  readonly filename: string
  readonly importedAt: string
  readonly trainerName: string
  readonly pokemonCount: number
}

export type BoxPokemonView = {
  readonly snapshotId: string
  readonly uploadId: string
  readonly profileId: string
  readonly game: string
  readonly gameVersion: string
  readonly filename: string
  readonly importedAt: string
  readonly pokemon: ImportedPokemon
}

export type PokemonBoxView = {
  readonly imports: readonly BoxImportView[]
  readonly pokemon: readonly BoxPokemonView[]
}

export type TrainerCardView = {
  readonly user: AccountView
  readonly trainerSprite: TrainerSpriteId
  readonly partner: BoxPokemonView | null
  readonly stats: {
    readonly leagues: number
    readonly cups: number
    readonly wins: number
    readonly losses: number
  }
}

export type BoxTeamDraftRequest = {
  readonly pokemonSnapshotIds: readonly string[]
}

export type BoxTeamDraftWorkspaceView = {
  readonly tournament: TournamentView
  readonly eligiblePokemon: readonly BoxPokemonView[]
  readonly draft: TeamDraftView | null
  readonly draftPokemonSnapshotIds: readonly string[]
}
