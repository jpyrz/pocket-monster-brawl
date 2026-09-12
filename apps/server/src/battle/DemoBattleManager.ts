import { createRequire } from 'node:module'
import type {
  BattleEventView,
  BattleMoveView,
  BattlePokemonView,
  DemoBattleChoice,
  DemoBattleView,
  DemoPlayerId,
} from '@pmb/domain'
import { validateAndPackDemoTeams } from './demoTeams.js'

type ShowdownSidePokemon = {
  ident: string
  details: string
  condition: string
  active: boolean
  moves: string[]
}

type ShowdownRequest = {
  wait?: boolean
  forceSwitch?: boolean[]
  active?: Array<{
    moves: Array<{
      move: string
      id: string
      pp?: number
      maxpp?: number
      disabled?: boolean | string
    }>
    trapped?: boolean
  }>
  side: {
    name: string
    id: DemoPlayerId
    pokemon: ShowdownSidePokemon[]
  }
}

type PlayerStreams = ReturnType<typeof getPlayerStreams>

const require = createRequire(import.meta.url)
const { BattleStream, Dex, getPlayerStreams } = require('pokemon-showdown') as typeof import('pokemon-showdown')
export const showdownEngineVersion = (require('pokemon-showdown/package.json') as { version: string }).version
const playerNames: Record<DemoPlayerId, string> = { p1: 'Red', p2: 'Blue' }

export type RegisteredBattleTeam = {
  packedTeam: string
  registrationId: string
  trainerName: string
}

export type BattleManagerOptions = {
  matchId?: string
  seed?: [number, number, number, number]
  teams?: Partial<Record<DemoPlayerId, RegisteredBattleTeam>>
}

export class BattleRequestError extends Error {
  constructor(message: string, readonly statusCode = 409) {
    super(message)
    this.name = 'BattleRequestError'
  }
}

export class DemoBattleManager {
  private battleStream: InstanceType<typeof BattleStream> | null = null
  private playerStreams: PlayerStreams | null = null
  private initialization: Promise<void> | null = null
  private requests: Partial<Record<DemoPlayerId, ShowdownRequest>> = {}
  private requestIds: Record<DemoPlayerId, number> = { p1: 0, p2: 0 }
  private submittedRequestIds: Partial<Record<DemoPlayerId, number>> = {}
  private logs: Record<DemoPlayerId, string[]> = { p1: [], p2: [] }
  private events: Record<DemoPlayerId, BattleEventView[]> = { p1: [], p2: [] }
  private protocol: Record<DemoPlayerId, string[]> = { p1: [], p2: [] }
  private eventSequences: Record<DemoPlayerId, number> = { p1: 0, p2: 0 }
  private eventTurns: Record<DemoPlayerId, number> = { p1: 0, p2: 0 }
  private errors: Partial<Record<DemoPlayerId, string>> = {}
  private seenIdempotencyKeys = new Set<string>()
  private registeredTeams: Partial<Record<DemoPlayerId, RegisteredBattleTeam>>
  private readonly matchId: string
  private readonly seed: [number, number, number, number]

  constructor(options: BattleManagerOptions = {}) {
    this.matchId = options.matchId ?? 'demo-gen3-battle'
    this.seed = options.seed ?? [1, 2, 3, 4]
    this.registeredTeams = structuredClone(options.teams ?? {})
  }

  async useRegisteredTeam(player: DemoPlayerId, team: RegisteredBattleTeam): Promise<void> {
    this.registeredTeams[player] = structuredClone(team)
    await this.reset()
  }

  async reset(): Promise<void> {
    const initialization = this.initialize().catch((error) => {
      if (this.initialization === initialization) this.initialization = null
      throw error
    })
    this.initialization = initialization
    return initialization
  }

  private async initialize(): Promise<void> {
    this.battleStream?.destroy()
    this.battleStream = null
    this.playerStreams = null
    this.requests = {}
    this.requestIds = { p1: 0, p2: 0 }
    this.submittedRequestIds = {}
    this.logs = { p1: [], p2: [] }
    this.events = { p1: [], p2: [] }
    this.protocol = { p1: [], p2: [] }
    this.eventSequences = { p1: 0, p2: 0 }
    this.eventTurns = { p1: 0, p2: 0 }
    this.errors = {}
    this.seenIdempotencyKeys.clear()

    const battleStream = new BattleStream({ keepAlive: true })
    const playerStreams = getPlayerStreams(battleStream)
    this.battleStream = battleStream
    this.playerStreams = playerStreams

    void this.consume('p1', playerStreams.p1)
    void this.consume('p2', playerStreams.p2)

    const teams = this.registeredTeams.p1 && this.registeredTeams.p2 ? null : validateAndPackDemoTeams()
    const p1 = this.registeredTeams.p1
    const p2 = this.registeredTeams.p2
    await playerStreams.omniscient.write([
      `>start ${JSON.stringify({ formatid: 'gen3customgame', seed: this.seed })}`,
      `>player p1 ${JSON.stringify({ name: p1?.trainerName ?? playerNames.p1, team: p1?.packedTeam ?? teams!.p1 })}`,
      `>player p2 ${JSON.stringify({ name: p2?.trainerName ?? playerNames.p2, team: p2?.packedTeam ?? teams!.p2 })}`,
    ].join('\n'))

    await this.waitUntil(() => Boolean(this.requests.p1 && this.requests.p2))
  }

  close(): void {
    this.battleStream?.destroy()
    this.battleStream = null
    this.playerStreams = null
    this.initialization = null
  }

  async getView(player: DemoPlayerId): Promise<DemoBattleView> {
    await this.ensureInitialized()
    return this.buildView(player)
  }

  async submit(
    player: DemoPlayerId,
    choice: DemoBattleChoice,
    beforeApply?: () => Promise<void>,
  ): Promise<DemoBattleView> {
    await this.ensureInitialized()
    const key = `${player}:${choice.idempotencyKey}`
    if (this.seenIdempotencyKeys.has(key)) return this.buildView(player)

    const request = this.requests[player]
    const currentRequestId = this.requestIds[player]
    if (!request || this.battleStream?.battle?.ended) {
      throw new BattleRequestError('This battle is not accepting choices.')
    }
    if (choice.requestId !== currentRequestId) {
      throw new BattleRequestError(`Stale battle request. Expected request ${currentRequestId}.`)
    }
    if (this.submittedRequestIds[player] === currentRequestId || request.wait) {
      throw new BattleRequestError('A choice has already been submitted for this request.')
    }

    const command = this.toShowdownChoice(request, choice)
    await beforeApply?.()
    this.seenIdempotencyKeys.add(key)
    this.submittedRequestIds[player] = currentRequestId
    this.errors[player] = undefined
    await this.playerStreams?.[player].write(command)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return this.buildView(player)
  }

  winnerPlayer(): DemoPlayerId | null {
    const winner = this.battleStream?.battle?.winner
    if (!winner) return null
    const p1Name = this.registeredTeams.p1?.trainerName ?? playerNames.p1
    return winner === p1Name ? 'p1' : 'p2'
  }

  showdownLog(): string {
    return this.protocol.p1.join('\n')
  }

  private ensureInitialized(): Promise<void> {
    return this.initialization ?? this.reset()
  }

  private async consume(player: DemoPlayerId, stream: PlayerStreams[DemoPlayerId]): Promise<void> {
    for await (const chunk of stream) {
      for (const line of chunk.split('\n')) {
        if (line.startsWith('|') && !line.startsWith('|request|') && !line.startsWith('|error|')) {
          this.protocol[player].push(line)
        }
        if (line.startsWith('|request|')) {
          const request = JSON.parse(line.slice('|request|'.length)) as ShowdownRequest
          this.requests[player] = request
          if (!request.wait) {
            this.requestIds[player] += 1
            this.submittedRequestIds[player] = undefined
          }
          continue
        }
        if (line.startsWith('|error|')) {
          this.errors[player] = line.slice('|error|'.length).replace(/^\[[^\]]+\]\s*/, '')
          this.submittedRequestIds[player] = undefined
          continue
        }
        const message = humanizeProtocolLine(line)
        if (message) this.logs[player] = [...this.logs[player], message].slice(-10)
        if (line.startsWith('|turn|')) this.eventTurns[player] = Number(line.slice('|turn|'.length))
        const event = protocolEvent(
          line,
          player,
          this.eventSequences[player] + 1,
          this.eventTurns[player],
        )
        if (event) {
          this.eventSequences[player] = event.sequence
          this.events[player] = [...this.events[player], event].slice(-40)
        }
      }
    }
  }

  private toShowdownChoice(request: ShowdownRequest, choice: DemoBattleChoice): string {
    if (!Number.isInteger(choice.slot) || choice.slot < 1) {
      throw new BattleRequestError('Choice slots are one-based positive integers.', 400)
    }

    const forcedSwitch = request.forceSwitch?.some(Boolean) ?? false
    if (forcedSwitch && choice.type !== 'switch') {
      throw new BattleRequestError('A replacement Pokémon must be selected.')
    }

    if (choice.type === 'move') {
      if (forcedSwitch || !request.active?.[0]) {
        throw new BattleRequestError('A move is not legal for this request.')
      }
      const move = request.active[0].moves[choice.slot - 1]
      if (!move || move.disabled || move.pp === 0) {
        throw new BattleRequestError('That move is not currently available.')
      }
      return `move ${choice.slot}`
    }

    if (!forcedSwitch && request.active?.[0]?.trapped) {
      throw new BattleRequestError('The active Pokémon is trapped and cannot switch.')
    }
    const pokemon = request.side.pokemon[choice.slot - 1]
    if (!pokemon || pokemon.active || pokemon.condition.includes('fnt')) {
      throw new BattleRequestError('That Pokémon cannot be switched in.')
    }
    return `switch ${choice.slot}`
  }

  private buildView(player: DemoPlayerId): DemoBattleView {
    const request = this.requests[player]
    const battle = this.battleStream?.battle
    const opponentId: DemoPlayerId = player === 'p1' ? 'p2' : 'p1'
    const playerRegistration = this.registeredTeams[player]
    const opponentRegistration = this.registeredTeams[opponentId]
    const opponentSide = battle?.sides[opponentId === 'p1' ? 0 : 1]
    const opponent = opponentSide?.active[0]
    const team = request?.side.pokemon.map((pokemon, index) => privatePokemonView(pokemon, index)) ?? []
    const moves: BattleMoveView[] = request?.active?.[0]?.moves.map((move, index) => ({
      slot: index + 1,
      id: move.id,
      name: move.move,
      type: Dex.moves.get(move.id).type,
      pp: move.pp ?? null,
      maxPp: move.maxpp ?? null,
      disabled: Boolean(move.disabled) || move.pp === 0,
    })) ?? []

    let phase: DemoBattleView['phase'] = 'loading'
    if (battle?.ended) phase = 'ended'
    else if (this.submittedRequestIds[player] === this.requestIds[player] || request?.wait) phase = 'waiting'
    else if (request?.forceSwitch?.some(Boolean)) phase = 'switch'
    else if (request?.active) phase = 'move'

    return {
      matchId: this.matchId,
      engineVersion: showdownEngineVersion,
      format: 'gen3customgame',
      player,
      playerName: playerRegistration?.trainerName ?? playerNames[player],
      opponentName: opponentRegistration?.trainerName ?? playerNames[opponentId],
      teamSource: playerRegistration ? 'registered-save' : 'fixture',
      registrationId: playerRegistration?.registrationId ?? null,
      turn: battle?.turn ?? 0,
      phase,
      requestId: request && !request.wait ? this.requestIds[player] : null,
      active: team.find((pokemon) => pokemon.active) ?? null,
      opponent: opponent ? {
        slot: opponent.position + 1,
        name: opponent.name,
        species: opponent.species.name,
        level: opponent.level,
        gender: opponent.gender,
        status: opponent.status || null,
        active: true,
        fainted: opponent.fainted,
        hp: null,
        maxHp: null,
        hpPercent: opponent.maxhp ? Math.round((opponent.hp / opponent.maxhp) * 100) : 0,
      } : null,
      moves,
      team,
      log: this.logs[player],
      events: this.events[player],
      protocol: this.protocol[player],
      winner: battle?.winner ?? null,
      error: this.errors[player] ?? null,
    }
  }

  private async waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) throw new Error('Showdown did not produce an initial request.')
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
}

function privatePokemonView(pokemon: ShowdownSidePokemon, index: number): BattlePokemonView {
  const condition = parseCondition(pokemon.condition)
  const detailParts = pokemon.details.split(',').map((part) => part.trim())
  const levelPart = detailParts.find((part) => /^L\d+$/.test(part))
  const gender = detailParts.find((part) => part === 'M' || part === 'F') ?? 'N'
  return {
    slot: index + 1,
    name: pokemon.ident.replace(/^p[1-4]:\s*/, ''),
    species: detailParts[0] ?? pokemon.ident,
    level: levelPart ? Number(levelPart.slice(1)) : 100,
    gender,
    status: condition.status,
    active: pokemon.active,
    fainted: condition.fainted,
    hp: condition.hp,
    maxHp: condition.maxHp,
    hpPercent: condition.maxHp ? Math.round((condition.hp / condition.maxHp) * 100) : 0,
  }
}

function parseCondition(condition: string): {
  hp: number
  maxHp: number
  status: string | null
  fainted: boolean
} {
  const [health = '0/0', status] = condition.split(' ')
  if (health === '0' || status === 'fnt') return { hp: 0, maxHp: 0, status: null, fainted: true }
  const [hp = 0, maxHp = 0] = health.split('/').map(Number)
  return { hp, maxHp, status: status ?? null, fainted: hp <= 0 }
}

function humanizeProtocolLine(line: string): string | null {
  if (line === '|start') return 'Battle started.'
  const parts = line.split('|')
  const command = parts[1] ?? ''
  const pokemonName = (value = '') => value.replace(/^p[1-4][a-z]?:\s*/, '')

  if (command === 'turn') return `Turn ${parts[2]}.`
  if (command === 'switch' || command === 'drag') return `${pokemonName(parts[2])} entered the battle.`
  if (command === 'move') return `${pokemonName(parts[2])} used ${parts[3]}.`
  if (command === 'faint') return `${pokemonName(parts[2])} fainted.`
  if (command === 'win') return `${parts[2]} won the battle.`
  if (command === 'tie') return 'The battle ended in a tie.'
  if (command === '-supereffective') return `It's super effective!`
  if (command === '-resisted') return `It's not very effective.`
  if (command === '-crit') return 'A critical hit!'
  if (command === '-status') return `${pokemonName(parts[2])} was ${parts[3]}.`
  if (command === '-damage') return `${pokemonName(parts[2])} lost health.`
  if (command === '-heal') return `${pokemonName(parts[2])} recovered health.`
  if (command === 'cant') return `${pokemonName(parts[2])} could not move.`
  return null
}

function protocolEvent(
  line: string,
  player: DemoPlayerId,
  sequence: number,
  turn: number,
): BattleEventView | null {
  const message = humanizeProtocolLine(line)
  if (!message) return null
  const parts = line.split('|')
  const command = parts[1] ?? ''
  const kindByCommand: Partial<Record<string, BattleEventView['kind']>> = {
    move: 'move',
    '-damage': 'damage',
    '-heal': 'heal',
    '-status': 'status',
    faint: 'faint',
    switch: 'switch',
    drag: 'switch',
    cant: 'message',
    '-supereffective': 'message',
    '-resisted': 'message',
    '-crit': 'message',
    win: 'message',
    tie: 'message',
  }
  const kind = kindByCommand[command]
  if (!kind) return null

  const ident = parts[2] ?? ''
  const target = /^p[12][a-z]?:/.test(ident)
    ? ident.startsWith(player) ? 'player' : 'opponent'
    : null
  const condition = command === 'switch' || command === 'drag' ? parts[4] : parts[3]

  return {
    sequence,
    turn,
    kind,
    message,
    target,
    hpPercent: condition && (kind === 'damage' || kind === 'heal' || kind === 'switch')
      ? conditionPercent(condition)
      : kind === 'faint' ? 0 : null,
  }
}

function conditionPercent(condition: string): number {
  const health = condition.split(' ')[0] ?? '0'
  if (health === '0') return 0
  const [hp = 0, maxHp = 100] = health.split('/').map(Number)
  return maxHp ? Math.round((hp / maxHp) * 100) : 0
}
