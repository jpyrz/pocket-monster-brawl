export type GameGeneration = 2 | 3

export type SourceGameId = 'pokemon-firered' | 'synthetic-crystal'

export type BattleUiCapabilities = {
  readonly abilities: boolean
  readonly heldItems: boolean
  readonly natures: boolean
  readonly teamPreview: boolean
}

export type GameProfile = {
  readonly id: string
  readonly version: number
  readonly name: string
  readonly status: 'pilot' | 'test-only'
  readonly sourceGames: readonly SourceGameId[]
  readonly battleGeneration: GameGeneration
  readonly showdownFormat: string
  readonly teamSize: number
  readonly levelPolicy: 'actual'
  readonly normalization: {
    readonly startFullyHealed: true
    readonly movePp: 'showdown-default-max'
  }
  readonly ui: BattleUiCapabilities
}

export const profiles = [
  {
    id: 'firered-gen3-v1',
    version: 1,
    name: 'FireRed · Generation III',
    status: 'pilot',
    sourceGames: ['pokemon-firered'],
    battleGeneration: 3,
    showdownFormat: 'gen3customgame',
    teamSize: 6,
    levelPolicy: 'actual',
    normalization: {
      startFullyHealed: true,
      movePp: 'showdown-default-max',
    },
    ui: {
      abilities: true,
      heldItems: true,
      natures: true,
      teamPreview: false,
    },
  },
  {
    id: 'synthetic-gen2-v1',
    version: 1,
    name: 'Synthetic Generation II fixture',
    status: 'test-only',
    sourceGames: ['synthetic-crystal'],
    battleGeneration: 2,
    showdownFormat: 'gen2customgame',
    teamSize: 6,
    levelPolicy: 'actual',
    normalization: {
      startFullyHealed: true,
      movePp: 'showdown-default-max',
    },
    ui: {
      abilities: false,
      heldItems: true,
      natures: false,
      teamPreview: false,
    },
  },
] as const satisfies readonly GameProfile[]

export const publicProfiles = profiles.filter((profile) => profile.status === 'pilot')

export class UnsupportedProfileCombinationError extends Error {
  constructor(profileId: string, sourceGame: SourceGameId) {
    super(`Source game ${sourceGame} is not enabled for profile ${profileId}.`)
    this.name = 'UnsupportedProfileCombinationError'
  }
}

export function resolveProfile(profileId: string, sourceGame: SourceGameId): GameProfile {
  const profile = profiles.find((candidate) => candidate.id === profileId)

  if (!profile || !(profile.sourceGames as readonly SourceGameId[]).includes(sourceGame)) {
    throw new UnsupportedProfileCombinationError(profileId, sourceGame)
  }

  return profile
}

