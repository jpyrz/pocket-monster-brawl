import { createRequire } from 'node:module'
import type { ImportedPokemon } from '@pmb/domain'

const require = createRequire(import.meta.url)
const { TeamValidator, Teams } = require('pokemon-showdown') as typeof import('pokemon-showdown')

export type ShowdownTeamSet = {
  name: string
  species: string
  item: string
  ability: string
  moves: string[]
  nature: string
  gender: 'M' | 'F' | 'N'
  evs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
  ivs: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
  level: number
  happiness: number
  shiny: boolean
}

export class TeamAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamAdapterError'
  }
}

export function importedPokemonToShowdownSet(pokemon: ImportedPokemon): ShowdownTeamSet {
  return {
    name: pokemon.nickname || pokemon.species,
    species: pokemon.species,
    item: pokemon.heldItem ?? '',
    ability: pokemon.ability,
    moves: pokemon.moves.map((move) => move.name),
    nature: pokemon.nature,
    gender: pokemon.gender === 'M' || pokemon.gender === 'F' ? pokemon.gender : 'N',
    evs: {
      hp: pokemon.evs.hp,
      atk: pokemon.evs.attack,
      def: pokemon.evs.defense,
      spa: pokemon.evs.specialAttack,
      spd: pokemon.evs.specialDefense,
      spe: pokemon.evs.speed,
    },
    ivs: {
      hp: pokemon.ivs.hp,
      atk: pokemon.ivs.attack,
      def: pokemon.ivs.defense,
      spa: pokemon.ivs.specialAttack,
      spd: pokemon.ivs.specialDefense,
      spe: pokemon.ivs.speed,
    },
    level: pokemon.level,
    happiness: pokemon.friendship,
    shiny: pokemon.shiny,
  }
}

export function validateShowdownTeam(team: readonly ShowdownTeamSet[]): string {
  if (team.length < 1 || team.length > 6) {
    throw new TeamAdapterError('A registered FireRed team must contain between one and six Pokémon.')
  }

  const mutableTeam = team.map((set) => ({ ...set, moves: [...set.moves] }))
  const problems = new TeamValidator('gen3customgame').validateTeam(mutableTeam)
  if (problems?.length) throw new TeamAdapterError(`Showdown rejected this team: ${problems.join(' ')}`)
  return Teams.pack(mutableTeam)
}

export function mapAndValidateImportedTeam(pokemon: readonly ImportedPokemon[]): {
  sets: ShowdownTeamSet[]
  packed: string
} {
  const sets = pokemon.map(importedPokemonToShowdownSet)
  return { sets, packed: validateShowdownTeam(sets) }
}
