export type DemoPlayerId = 'p1' | 'p2'

export type BattlePhase = 'loading' | 'move' | 'switch' | 'waiting' | 'ended'

export type BattleMoveView = {
  readonly slot: number
  readonly id: string
  readonly name: string
  readonly type: string
  readonly pp: number | null
  readonly maxPp: number | null
  readonly disabled: boolean
}

export type BattlePokemonView = {
  readonly slot: number
  readonly name: string
  readonly species: string
  readonly level: number
  readonly gender: string
  readonly status: string | null
  readonly active: boolean
  readonly fainted: boolean
  readonly hp: number | null
  readonly maxHp: number | null
  readonly hpPercent: number
}

export type BattleEventView = {
  readonly sequence: number
  readonly turn: number
  readonly kind: 'move' | 'damage' | 'heal' | 'status' | 'faint' | 'switch' | 'message'
  readonly message: string
  readonly target: 'player' | 'opponent' | null
  readonly hpPercent: number | null
}

export type DemoBattleView = {
  readonly matchId: string
  readonly engineVersion: string
  readonly format: 'gen3customgame'
  readonly player: DemoPlayerId
  readonly playerName: string
  readonly opponentName: string
  readonly teamSource: 'fixture' | 'registered-save'
  readonly registrationId: string | null
  readonly turn: number
  readonly phase: BattlePhase
  readonly requestId: number | null
  readonly active: BattlePokemonView | null
  readonly opponent: BattlePokemonView | null
  readonly moves: readonly BattleMoveView[]
  readonly team: readonly BattlePokemonView[]
  readonly log: readonly string[]
  readonly events: readonly BattleEventView[]
  readonly protocol: readonly string[]
  readonly winner: string | null
  readonly error: string | null
}

export type DemoBattleChoice = {
  readonly requestId: number
  readonly idempotencyKey: string
  readonly type: 'move' | 'switch'
  readonly slot: number
}
