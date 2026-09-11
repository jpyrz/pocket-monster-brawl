type PokemonProvenance = {
  readonly uploadId: string
  readonly sourceGame: SourceGameId
  readonly sourceSlot: string
  readonly rawPokemonHash: string
  readonly importerVersion: string
}

type CommonPokemonSnapshot = {
  readonly species: string
  readonly form: string | null
  readonly level: number
  readonly nickname: string
  readonly gender: 'M' | 'F' | 'N'
  readonly shiny: boolean
  readonly moves: readonly string[]
  readonly heldItem: string | null
  readonly friendship: number
  readonly provenance: PokemonProvenance
}

export type GenerationTwoPokemon = CommonPokemonSnapshot & {
  readonly generation: 2
  readonly dvs: {
    readonly attack: number
    readonly defense: number
    readonly speed: number
    readonly special: number
  }
  readonly statExperience: {
    readonly hp: number
    readonly attack: number
    readonly defense: number
    readonly speed: number
    readonly special: number
  }
}

export type GenerationThreePokemon = CommonPokemonSnapshot & {
  readonly generation: 3
  readonly ability: string
  readonly nature: string
  readonly ivs: StatBlock
  readonly evs: StatBlock
}

export type StatBlock = {
  readonly hp: number
  readonly attack: number
  readonly defense: number
  readonly specialAttack: number
  readonly specialDefense: number
  readonly speed: number
}

export type SourcePokemonSnapshot = GenerationTwoPokemon | GenerationThreePokemon

import type { SourceGameId } from './profiles.js'

