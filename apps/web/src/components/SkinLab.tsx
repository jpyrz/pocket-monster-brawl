import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  fixtureSkin,
  type BattleEventView,
  type DemoBattleChoice,
  type DemoBattleView,
  type DemoPlayerId,
  type LogicalControl,
  type SkinRect,
} from '@pmb/domain'
import { linearMenuFocus, moveGridFocus } from './battleSelection'
import { createClientUuid } from './clientUuid'
import { ShowdownBattleScene } from './ShowdownBattleScene'
import styles from './SkinLab.module.scss'

const keyboardControls: Record<string, LogicalControl> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'confirm', ' ': 'confirm', Escape: 'back', Backspace: 'back',
}

function rectStyle(rect: SkinRect): CSSProperties {
  const { width, height } = fixtureSkin.mappingSize
  return {
    '--x': `${(rect.x / width) * 100}%`,
    '--y': `${(rect.y / height) * 100}%`,
    '--w': `${(rect.width / width) * 100}%`,
    '--h': `${(rect.height / height) * 100}%`,
  } as CSSProperties
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
  const [lastInput, setLastInput] = useState('Ready')
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

  return (
    <main className={styles.lab}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>{isMatch ? 'Tournament match' : 'Live integration spike'}</p>
        <h1>{isMatch ? 'Your team. Your side.' : 'One battle. Every input.'}</h1>
        <p>
          {isMatch
            ? 'This is your authenticated side of a server-owned Generation III battle. Your opponent has their own private view.'
            : 'This controller drives a server-owned Generation III Pokémon Showdown battle. Open a second tab as Blue to answer Red’s choices.'}
        </p>
        <div className={styles.disclosure}>
          <strong>{view?.teamSource === 'registered-save' ? 'Registered save team loaded.' : 'Real engine, fixture teams.'}</strong>{' '}
          {view?.teamSource === 'registered-save'
            ? 'Your selected Pokémon keep their source level, moves, ability, nature, IVs, EVs, friendship, and held items.'
            : 'Import and lock a FireRed team to replace Red’s fixture roster.'}
        </div>
      </section>

      <section className={styles.demo} aria-label="Live controller battle demonstration">
        <div className={styles.device} style={{ aspectRatio: `${fixtureSkin.mappingSize.width} / ${fixtureSkin.mappingSize.height}` }}>
          <div className={styles.topPanel} aria-hidden="true" />
          <div className={styles.screen} style={rectStyle(fixtureSkin.screen)}>
            {!view ? (
              <div className={styles.battleMessage}>{battle.isError ? battle.error.message : 'Connecting to battle…'}</div>
            ) : (
              <>
                <ShowdownBattleScene player={player} protocol={view.protocol} />

                {!isPlayingEvents && (showingParty ? (
                  <div className={`${styles.choicePanel} ${styles.partyPanel} ${view.phase === 'switch' ? styles.forcedPanel : ''}`} aria-label="Choose a Pokémon">
                    <p>Choose a Pokémon</p>
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
                ) : showingMoves ? (
                  <div className={`${styles.choicePanel} ${styles.movePanel}`} aria-label="Choose a move">
                    <p>Choose a move</p>
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
                        <span>{move.type} · {move.pp ?? '—'}/{move.maxPp ?? '—'} PP</span>
                      </button>
                    ))}
                  </div>
                ) : null)}

                {!isPlayingEvents && view.phase === 'move' && (
                  <div className={styles.commandRail} aria-label="Battle commands">
                    <button
                      aria-pressed={choicePanel === 'moves'}
                      className={choicePanel === 'commands' && focusedItem === 0 ? styles.focusedChoice : undefined}
                      onClick={() => { setChoicePanel('moves'); setFocusedItem(0); setLastInput('touch') }}
                      type="button"
                    >
                      <strong>Fight</strong><span>Moves</span>
                    </button>
                    <button
                      aria-pressed={choicePanel === 'party'}
                      className={choicePanel === 'commands' && focusedItem === 1 ? styles.focusedChoice : undefined}
                      onClick={() => { setChoicePanel('party'); setFocusedItem(0); setLastInput('touch') }}
                      type="button"
                    >
                      <strong>Pokémon</strong><span>Team</span>
                    </button>
                  </div>
                )}

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

          <div className={styles.shoulderStrip} aria-hidden="true">
            <span>L</span><strong>PM BRAWL</strong><span>R</span>
          </div>
          <div className={styles.fixtureLabel}>SHOWDOWN {view?.engineVersion ?? 'CONNECTING'} · {isPlayingEvents ? 'RESOLVING' : view?.phase.toUpperCase() ?? 'LOADING'}</div>
          {fixtureSkin.controls.map((control) => (
            <button
              aria-label={control.label}
              className={`${styles.control} ${styles[`control_${control.action}`] ?? ''}`}
              key={control.action}
              onClick={() => handleControl(control.action)}
              style={rectStyle(control.rect)}
              type="button"
            >
              {control.label}
            </button>
          ))}
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
        </div>

        <aside className={styles.readout} aria-live="polite">
          <p><span>Player</span><strong>{view?.playerName ?? 'Connecting'}</strong></p>
          <p><span>Battle state</span><strong>{view?.phase ?? battle.status}</strong></p>
          <p><span>Last event</span><strong>{activeEvent?.message ?? view?.log.at(-1) ?? 'Waiting for the engine'}</strong></p>
          <p><span>Last input</span><strong>{lastInput}</strong></p>
          <small>A opens or submits the focused choice. B closes a choice panel; Start opens your team.{!isMatch && ' Use the menu to switch player views or reset.'}</small>
        </aside>
      </section>
    </main>
  )
}
