import type { StatBlock } from './pokemon.js'

export type ImportedPokemonSource = {
  readonly kind: 'party' | 'box'
  readonly box: number | null
  readonly boxName: string | null
  readonly slot: number
}

export type ImportedMove = {
  readonly slot: number
  readonly id: number
  readonly name: string
  readonly pp: number
  readonly ppUps: number
}

export type ImportedPokemon = {
  readonly fingerprint: string
  readonly source: ImportedPokemonSource
  readonly speciesId: number
  readonly species: string
  readonly nickname: string
  readonly level: number
  readonly gender: string
  readonly shiny: boolean
  readonly egg: boolean
  readonly nature: string
  readonly ability: string
  readonly heldItem: string | null
  readonly friendship: number
  readonly experience: number
  readonly moves: readonly ImportedMove[]
  readonly stats: StatBlock
  readonly storedStats: StatBlock | null
  readonly ivs: StatBlock
  readonly evs: StatBlock
  readonly entityValid: boolean
  readonly legalityValid: boolean
  readonly legalityReport: string | null
}

export type SaveImportView = {
  readonly uploadId: string
  readonly filename: string
  readonly sourceDevice: 'Analogue Pocket'
  readonly profileId: 'firered-gen3-v1'
  readonly importedAt: string
  readonly parserVersion: string
  readonly sha256: string
  readonly size: number
  readonly game: string
  readonly gameVersion: string
  readonly language: string
  readonly checksumsValid: boolean
  readonly trainer: {
    readonly name: string
    readonly tid: number
    readonly sid: number
    readonly playTime: string
  }
  readonly pokemon: readonly ImportedPokemon[]
  readonly warnings: readonly string[]
  readonly rawSaveStored: false
}
