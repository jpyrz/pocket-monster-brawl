import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  type BattleEventView,
  type DemoBattleChoice,
  type DemoBattleView,
  type DemoPlayerId,
  type LogicalControl,
} from '@pmb/domain'
import { linearMenuFocus, moveGridFocus } from './battleSelection'
import { createClientUuid } from './clientUuid'
import { ShowdownBattleScene } from './ShowdownBattleScene'
import { TrainerGearShell } from './TrainerGearShell'
import styles from './SkinLab.module.scss'

const keyboardControls: Record<string, LogicalControl> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back',
}

async function readBattle(player: DemoPlayerId, matchId?: string): Promise<DemoBattleView> {
  const response = await fetch(matchId ? `/api/matches/${matchId}` : `/api/demo-battle/${player}`)
  if (!response.ok) throw new Error('The local battle server is not available.')
  return response.json() as Promise<DemoBattleView>
}

async function sendChoice(player: DemoPlayerId, choice: DemoBattleChoice, matchId?: string): Promise<DemoBattleView> {
  const response = await fetch(matchId ? `/api/matches/${matchId}/choices` : `/api/demo-battle/${player}/choices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(choice),
  })
  const body = await response.json() as DemoBattleView | { error?: string }
  if (!response.ok) throw new Error(('error' in body && body.error) || 'The choice was rejected.')
  return body as DemoBattleView
}

async function resetBattle(): Promise<DemoBattleView> {
  const response = await fetch('/api/demo-battle/reset', { method: 'POST' })
  if (!response.ok) throw new Error('The battle could not be reset.')
  return response.json() as Promise<DemoBattleView>
}

export function SkinLab() {
  const [searchParams] = useSearchParams()
  const { battleId } = useParams()
  const routePlayer: DemoPlayerId = searchParams.get('player') === 'p2' ? 'p2' : 'p1'
  const isMatch = Boolean(battleId)
  const queryClient = useQueryClient()
  const lastEventSequence = useRef<number | null>(null)
  const [eventQueue, setEventQueue] = useState<BattleEventView[]>([])
  const [activeEvent, setActiveEvent] = useState<BattleEventView | null>(null)
  const ingestBattleEvents = useCallback((next: DemoBattleView) => {
    const newestSequence = next.events.at(-1)?.sequence ?? 0
    if (lastEventSequence.current === null || newestSequence < lastEventSequence.current) {
      lastEventSequence.current = newestSequence
      return
    }
    const freshEvents = next.events.filter((event) => event.sequence > lastEventSequence.current!)
    lastEventSequence.current = newestSequence
    if (freshEvents.length) {
      setEventQueue((current) => [...current, ...freshEvents])
    }
  }, [])
  const battle = useQuery({
    queryKey: ['battle', battleId ?? 'demo', routePlayer],
    queryFn: async () => {
      const next = await readBattle(routePlayer, battleId)
      ingestBattleEvents(next)
      return next
    },
    refetchInterval: 400,
    retry: false,
  })
  const [focusedItem, setFocusedItem] = useState(0)
  const [choicePanel, setChoicePanel] = useState<'commands' | 'moves' | 'party'>('commands')
  const [, setLastInput] = useState('Ready')
  const [menuOpen, setMenuOpen] = useState(false)
  const view = battle.data
  const player = view?.player ?? routePlayer
  const otherPlayer: DemoPlayerId = player === 'p1' ? 'p2' : 'p1'
  const showingParty = choicePanel === 'party' || view?.phase === 'switch'
  const showingMoves = choicePanel === 'moves' && view?.phase === 'move'
  const availableTeam = useMemo(
    () => view?.team.filter((pokemon) => !pokemon.active && !pokemon.fainted) ?? [],
    [view?.team],
  )
  const itemCount = showingParty ? availableTeam.length : showingMoves ? (view?.moves.length ?? 0) : 2

  const choice = useMutation({
    mutationFn: ({ type, slot }: Pick<DemoBattleChoice, 'type' | 'slot'>) => {
      if (view?.requestId == null) throw new Error('There is no open battle request.')
      return sendChoice(player, {
        requestId: view.requestId,
        idempotencyKey: `${player}-${view.requestId}-${type}-${slot}-${createClientUuid()}`,
        type,
        slot,
      }, battleId)
    },
    onSuccess: (next) => {
      ingestBattleEvents(next)
      queryClient.setQueryData(['battle', battleId ?? 'demo', routePlayer], next)
      void queryClient.invalidateQueries({ queryKey: ['battle'] })
      setFocusedItem(0)
      setChoicePanel('commands')
    },
  })

  const reset = useMutation({
    mutationFn: resetBattle,
    onSuccess: () => {
      setFocusedItem(0)
      setChoicePanel('commands')
      lastEventSequence.current = null
      setEventQueue([])
      setActiveEvent(null)
      setMenuOpen(false)
      void queryClient.invalidateQueries({ queryKey: ['battle'] })
    },
  })

  const submitChoice = useCallback((nextChoice: Pick<DemoBattleChoice, 'type' | 'slot'>) => {
    choice.mutate(nextChoice)
  }, [choice])

  const isPlayingEvents = activeEvent !== null || eventQueue.length > 0

  useEffect(() => {
    if (activeEvent || !eventQueue.length) return
    const timer = window.setTimeout(() => {
      const [nextEvent, ...remaining] = eventQueue
      if (!nextEvent) return
      setEventQueue(remaining)
      setActiveEvent(nextEvent)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [activeEvent, eventQueue])

  useEffect(() => {
    if (!activeEvent) return
    const duration = activeEvent.kind === 'move' || activeEvent.kind === 'switch' ? 950 : 700
    const timer = window.setTimeout(() => setActiveEvent(null), duration)
    return () => window.clearTimeout(timer)
  }, [activeEvent])

  const chooseFocused = useCallback(() => {
    if (!view || view.phase === 'waiting' || view.phase === 'ended' || choice.isPending || isPlayingEvents) return
    if (showingParty) {
      const pokemon = availableTeam[focusedItem]
      if (pokemon) submitChoice({ type: 'switch', slot: pokemon.slot })
      return
    }
    if (showingMoves) {
      const move = view.moves[focusedItem]
      if (move && !move.disabled) submitChoice({ type: 'move', slot: move.slot })
      return
    }
    setChoicePanel(focusedItem === 0 ? 'moves' : 'party')
    setFocusedItem(0)
  }, [availableTeam, choice.isPending, focusedItem, isPlayingEvents, showingMoves, showingParty, submitChoice, view])

  const handleControl = useCallback((action: LogicalControl) => {
    setLastInput(action)
    if (action === 'menu') {
      setMenuOpen((open) => !open)
      return
    }
    if (menuOpen) {
      if (action === 'back') setMenuOpen(false)
      return
    }
    if (action === 'start' && view?.phase === 'move') {
      setChoicePanel('party')
      setFocusedItem(0)
      return
    }
    if (action === 'back' && choicePanel !== 'commands' && view?.phase !== 'switch') {
      setChoicePanel('commands')
      setFocusedItem(0)
      return
    }
    if (action === 'confirm') {
      chooseFocused()
      return
    }
    setFocusedItem((value) => choicePanel === 'commands'
      ? linearMenuFocus(value, action, itemCount)
      : moveGridFocus(value, action, itemCount))
  }, [choicePanel, chooseFocused, itemCount, menuOpen, view?.phase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = keyboardControls[event.key]
      if (!action) return
      event.preventDefault()
      handleControl(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleControl])

  const statusMessage = choice.error?.message ?? reset.error?.message ?? view?.error
  const activePokemon = view?.team.find((pokemon) => pokemon.active)
  const focusedMove = showingMoves ? view?.moves[focusedItem] : undefined

  return (
    <TrainerGearShell
      battle
      controls={{
        up: () => handleControl('up'),
        down: () => handleControl('down'),
        left: () => handleControl('left'),
        right: () => handleControl('right'),
        confirm: () => handleControl('confirm'),
        back: () => handleControl('back'),
        start: () => handleControl('start'),
        select: () => handleControl('menu'),
      }}
      showTabs={false}
    >
      <section className={styles.battleViewport} aria-label="Live battle">
          <div className={styles.screen}>
            {!view ? (
              <div className={styles.battleMessage}>{battle.isError ? battle.error.message : 'Connecting to battle…'}</div>
            ) : (
              <>
                <ShowdownBattleScene player={player} protocol={view.protocol} />

                {!isPlayingEvents && (showingParty ? (
                  <div className={`${styles.choicePanel} ${styles.partyPanel} ${view.phase === 'switch' ? styles.forcedPanel : ''}`} aria-label="Choose a Pokémon">
                    <header><strong>POKÉMON</strong><span>Choose a teammate</span></header>
                    <div className={styles.partyGrid}>
                    {availableTeam.map((pokemon, index) => (
                      <button
                        className={index === focusedItem ? styles.focusedChoice : undefined}
                        disabled={choice.isPending || isPlayingEvents}
                        key={pokemon.slot}
                        onClick={() => { setFocusedItem(index); submitChoice({ type: 'switch', slot: pokemon.slot }); setLastInput('touch') }}
                        type="button"
                      >
                        <strong>{pokemon.name}</strong>
                        <span>{pokemon.hp}/{pokemon.maxHp} HP</span>
                      </button>
                    ))}
                    </div>
                  </div>
                ) : showingMoves ? (
                  <div className={`${styles.choicePanel} ${styles.movePanel}`} aria-label="Choose a move">
                    <header><strong>MOVE</strong><span>Choose an attack</span></header>
                    <div className={styles.moveGrid}>
                      {view.moves.map((move, index) => (
                        <button
                          className={index === focusedItem ? styles.focusedChoice : undefined}
                          data-type={move.type.toLowerCase()}
                          disabled={move.disabled || choice.isPending || isPlayingEvents || view.phase !== 'move'}
                          key={move.id}
                          onClick={() => { setFocusedItem(index); submitChoice({ type: 'move', slot: move.slot }); setLastInput('touch') }}
                          type="button"
                        >
                          <strong>{move.name}</strong>
                          <span>{move.type}</span>
                        </button>
                      ))}
                    </div>
                    <aside className={styles.moveReadout}>
                      <small>PP</small>
                      <strong>{focusedMove?.pp ?? '—'}/{focusedMove?.maxPp ?? '—'}</strong>
                      <em data-type={focusedMove?.type.toLowerCase()}>{focusedMove?.type ?? '—'}</em>
                    </aside>
                  </div>
                ) : null)}

                {!isPlayingEvents && view.phase === 'move' && choicePanel === 'commands' && (
                  <div className={styles.commandPanel} aria-label="Battle commands">
                    <p><span>What will</span><strong>{activePokemon?.name ?? view.playerName}</strong><span>do?</span></p>
                    <div>
                    <button
                      className={focusedItem === 0 ? styles.focusedChoice : undefined}
                      onClick={() => { setChoicePanel('moves'); setFocusedItem(0); setLastInput('touch') }}
                      type="button"
                    >
                      <strong>FIGHT</strong><span>Moves</span>
                    </button>
                    <button
                      className={focusedItem === 1 ? styles.focusedChoice : undefined}
                      onClick={() => { setChoicePanel('party'); setFocusedItem(0); setLastInput('touch') }}
                      type="button"
                    >
                      <strong>POKÉMON</strong><span>Team</span>
                    </button>
                    </div>
                  </div>
                )}

                {isPlayingEvents && <div className={styles.dialoguePanel}>{activeEvent?.message ?? view.log.at(-1) ?? 'The battle continues…'}</div>}

                {!isPlayingEvents && (view.phase === 'waiting' || view.phase === 'ended') && (
                  <div className={styles.battleMessage}>
                    <strong>{view.phase === 'ended' ? `${view.winner ?? 'Nobody'} wins` : `Waiting for ${view.opponentName}…`}</strong>
                    <span>{view.log.at(-1) ?? 'Battle ready.'}</span>
                  </div>
                )}
                {statusMessage && <div className={styles.errorMessage}>{statusMessage}</div>}
              </>
            )}
          </div>
          <div className={styles.battleStatus} aria-live="polite">
            <span>{view?.playerName ?? 'Connecting'}</span>
            <strong>{isPlayingEvents ? 'RESOLVING' : view?.phase.toUpperCase() ?? 'LOADING'}</strong>
          </div>
          <section className={styles.expandedBattleLog} aria-label="Recent battle log">
            <header><strong>BATTLE LOG</strong><span>RECENT EVENTS</span></header>
            <div>{view?.log.slice(-8).reverse().map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}</div>
          </section>
          {menuOpen && (
            <div className={styles.systemMenu} role="dialog" aria-label="Controller menu">
              <p>{isMatch ? 'Tournament battle' : 'Live demo battle'}</p>
              <strong>Playing as {view?.playerName ?? player}</strong>
              <small>{view?.teamSource === 'registered-save' ? 'This side is using its locked save-sourced team.' : 'This side is using a fixture team held by the local server.'}</small>
              {!isMatch && <Link to={`/skin-lab?player=${otherPlayer}`}>Switch to {otherPlayer === 'p1' ? 'Red' : 'Blue'} view</Link>}
              {!isMatch && <button disabled={reset.isPending} type="button" onClick={() => reset.mutate()}>
                {reset.isPending ? 'Resetting…' : 'Reset battle'}
              </button>}
              <Link to="/">Exit to home</Link>
              <button type="button" onClick={() => setMenuOpen(false)}>Resume</button>
            </div>
          )}
      </section>
    </TrainerGearShell>
  )
}
