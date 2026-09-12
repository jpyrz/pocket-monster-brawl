import { useState } from 'react'
import styles from './TrainerGearPrototype.module.scss'

type GearMode = 'link' | 'team' | 'cup' | 'card'
type GearScreen = 'continue' | GearMode

const modes: ReadonlyArray<{ id: GearMode; code: string; label: string }> = [
  { id: 'link', code: 'LK', label: 'LINK' },
  { id: 'team', code: 'TM', label: 'TEAM' },
  { id: 'cup', code: 'CP', label: 'CUP' },
  { id: 'card', code: 'ID', label: 'CARD' },
]
const pikachuSprite = 'https://play.pokemonshowdown.com/sprites/ani/pikachu.gif'
const teamSprites = ['pikachu', 'charizard', 'blastoise', 'venusaur', 'snorlax', 'gengar']

export function TrainerGearPrototype() {
  const [screen, setScreen] = useState<GearScreen>('continue')
  const [selection, setSelection] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuSelection, setMenuSelection] = useState(0)
  const [helpOpen, setHelpOpen] = useState(false)
  const [message, setMessage] = useState('A tournament match is waiting. Check the board when you are ready.')
  const selectionCount = screen === 'link' || screen === 'team' ? 3 : screen === 'card' ? 2 : 1

  function selectMode(mode: GearMode) {
    setScreen(mode)
    setSelection(0)
    setMenuOpen(false)
    setHelpOpen(false)
    setMessage(mode === 'link'
      ? 'A tournament match is waiting. Check the board when you are ready.'
      : mode === 'team'
        ? 'Your registered team is locked for the Indigo Cup.'
        : mode === 'cup'
          ? 'Both trainers are ready. Open the match menu to begin.'
          : 'Your Trainer Card is visible to Link Club members.')
  }

  function cycleMode(direction: -1 | 1) {
    if (screen === 'continue') return
    const current = modes.findIndex((mode) => mode.id === screen)
    selectMode(modes[(current + direction + modes.length) % modes.length]!.id)
  }

  function moveCursor(direction: -1 | 1) {
    if (screen === 'continue' || helpOpen) return
    if (menuOpen) {
      setMenuSelection((current) => (current + direction + 4) % 4)
      return
    }
    setSelection((current) => (current + direction + selectionCount) % selectionCount)
  }

  function activateMenu(index: number) {
    if (index === 0) setMessage('Battle launch selected. This will open the live battle screen.')
    if (index === 1) setMessage('Both registered teams remain hidden until the match begins.')
    if (index === 2) setMessage('Singles · Best of 3 · Actual levels · No bag items.')
    setMenuOpen(false)
  }

  function activate(index = selection) {
    if (screen === 'continue') return selectMode('link')
    if (helpOpen) return setHelpOpen(false)
    if (menuOpen) {
      return activateMenu(menuSelection)
    }
    if (screen === 'link') {
      if (index === 0) selectMode('cup')
      if (index === 1) setMessage('Trainer roster selected. 2 trainers are connected.')
      if (index === 2) setMessage('There are no new Link Club invitations.')
    } else if (screen === 'team') {
      if (index === 0) setMessage('Registered team selected. Six Pokémon are locked.')
      if (index === 1) setMessage('Save import selected. A file picker would open here.')
      if (index === 2) setMessage('This team is locked for the current tournament.')
    } else if (screen === 'cup') {
      setMenuOpen(true)
      setMenuSelection(0)
    } else {
      setMessage(index === 0 ? 'League record: 0 wins · 0 losses.' : 'Trainer Gear settings selected.')
    }
  }

  function goBack() {
    if (helpOpen) return setHelpOpen(false)
    if (menuOpen) return setMenuOpen(false)
    if (screen === 'continue') return
    if (screen !== 'link') return selectMode('link')
    setScreen('continue')
  }

  function goToTitle() {
    setScreen('continue')
    setSelection(0)
    setMenuOpen(false)
    setHelpOpen(false)
  }

  return (
    <main className={styles.prototype}>
      <section className={`${styles.gear} ${screen === 'continue' ? styles.bootGear : ''}`} aria-label="Trainer Gear controller prototype">
        <header className={styles.hardwareTop}>
          <strong>PMB</strong><span>TRAINER GEAR / 02</span><i aria-label="Link connected" />
        </header>

        {screen !== 'continue' && (
          <nav className={styles.modeTabs} aria-label="Trainer Gear modes">
            {modes.map((mode) => (
              <button aria-current={screen === mode.id ? 'page' : undefined} key={mode.id} onClick={() => selectMode(mode.id)} type="button">
                <span>{mode.code}</span><small>{mode.label}</small>
              </button>
            ))}
          </nav>
        )}

        <div className={`${styles.display} ${screen === 'continue' ? styles.bootDisplay : ''}`}>
          {screen === 'continue' && <ContinueScreen onContinue={() => activate()} />}
          {screen === 'link' && <LinkScreen message={message} onActivate={activate} selection={selection} />}
          {screen === 'team' && <TeamScreen message={message} onActivate={activate} selection={selection} />}
          {screen === 'cup' && <CupScreen menuOpen={menuOpen} menuSelection={menuSelection} message={message} onActivate={() => activate()} onMenuActivate={activateMenu} />}
          {screen === 'card' && <CardScreen message={message} onActivate={activate} selection={selection} />}
          {helpOpen && <ControlHelp onClose={() => setHelpOpen(false)} />}
        </div>

        <ControllerDeck
          canCycle={screen !== 'continue'}
          onA={() => activate()}
          onB={goBack}
          onDown={() => moveCursor(1)}
          onLeft={() => moveCursor(-1)}
          onRight={() => moveCursor(1)}
          onSelect={() => setHelpOpen((open) => !open)}
          onShoulderLeft={() => cycleMode(-1)}
          onShoulderRight={() => cycleMode(1)}
          onStart={goToTitle}
          onUp={() => moveCursor(-1)}
        />
      </section>
    </main>
  )
}

function ContinueScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <div className={styles.bootScreen}>
      <div className={styles.bootMark} aria-hidden="true"><span /></div>
      <p className={styles.eyebrow}>Pocket Monster Brawl</p>
      <h1>TRAINER<br />GEAR</h1>
      <p className={styles.version}>SYSTEM 0.2 · CONTROLLER READY</p>
      <button className={styles.saveFile} onClick={onContinue} type="button">
        <span className={styles.cursor} aria-hidden="true">▶</span><img alt="Pikachu" src={pikachuSprite} />
        <span className={styles.saveDetails}><small>CONTINUE</small><strong>JAMES</strong><span>Indigo Cup · Team locked</span></span><b>›</b>
      </button>
      <p className={styles.controlHint}>PRESS A OR TAP THE SAVE FILE</p>
    </div>
  )
}

type ScreenProps = { selection: number; message: string; onActivate: (index: number) => void }
type MenuRow = readonly [string, string, string]

function LinkScreen({ selection, message, onActivate }: ScreenProps) {
  const rows = [
    ['TOURNAMENT BOARD', 'Indigo Cup · Match ready', '!'],
    ['TRAINER ROSTER', '2 registered trainers', '›'],
    ['LINK REQUESTS', 'No new invitations', '›'],
  ] as const
  return (
    <div className={styles.screenPage}>
      <header className={styles.screenTitle}><span>LINK</span><strong>INDIGO CLUB</strong><small>2 ONLINE</small></header>
      <section className={styles.linkHero}>
        <div className={styles.partnerPane}><span className={styles.levelTag}>PARTNER</span><img alt="Pikachu" src={pikachuSprite} /><strong>PIKACHU</strong><small>TEAM 01</small></div>
        <div className={styles.clubPane}><small>CURRENT LEAGUE</small><h2>INDIGO<br />LINK CLUB</h2><dl><div><dt>TRAINERS</dt><dd>2 / 8</dd></div><div><dt>YOUR ROLE</dt><dd>ADMIN</dd></div><div><dt>LINK</dt><dd className={styles.online}>ONLINE</dd></div></dl></div>
      </section>
      <MenuRows onActivate={onActivate} rows={rows} selection={selection} />
      <p className={styles.messageBox}>{message}</p>
    </div>
  )
}

function TeamScreen({ selection, message, onActivate }: ScreenProps) {
  const rows = [
    ['REGISTERED TEAM', '6 Pokémon · Lead Pikachu', '›'],
    ['IMPORT SAVE', 'FireRed save currently loaded', '›'],
    ['LOCK STATUS', 'Submitted and locked', '✓'],
  ] as const
  return (
    <div className={styles.screenPage}>
      <header className={styles.screenTitle}><span>TEAM</span><strong>INDIGO CUP</strong><small>6 LOCKED</small></header>
      <section className={styles.teamPreview}>
        <header><span>TEAM 01</span><strong>REGISTERED</strong><small>PRIVATE</small></header>
        <div>{teamSprites.map((pokemon, index) => <span key={pokemon}><img alt={pokemon} src={`https://play.pokemonshowdown.com/sprites/gen5/${pokemon}.png`} /><small>{index + 1}</small></span>)}</div>
      </section>
      <MenuRows onActivate={onActivate} rows={rows} selection={selection} />
      <p className={styles.messageBox}>{message}</p>
    </div>
  )
}

function CupScreen({ menuOpen, menuSelection, message, onActivate, onMenuActivate }: { menuOpen: boolean; menuSelection: number; message: string; onActivate: () => void; onMenuActivate: (index: number) => void }) {
  const menuItems = ['Begin battle', 'View teams', 'Match rules', 'Cancel']
  return (
    <div className={styles.screenPage}>
      <header className={styles.screenTitle}><span>CUP</span><strong>INDIGO CUP</strong><small>ROUND 1</small></header>
      <section className={styles.matchPanel}>
        <div className={styles.roundLabel}><span>01</span><strong>NEXT MATCH</strong><small>BEST OF 3</small></div>
        <div className={styles.versus}><div><i className={styles.trainerBall} /><strong>JAMES</strong><small>READY</small></div><b>VS</b><div><i className={styles.trainerBall} /><strong>GRUNDY</strong><small>READY</small></div></div>
        <button className={styles.matchAction} onClick={onActivate} type="button"><span className={styles.cursor} aria-hidden="true">▶</span>OPEN MATCH MENU</button>
      </section>
      <section className={styles.bracket} aria-label="Tournament bracket preview">
        <header><strong>BRACKET</strong><span>2 TRAINERS</span></header>
        <div className={styles.bracketLine}><div><span>01</span><strong>JAMES</strong><small>TEAM LOCKED</small></div><i /><div><span>02</span><strong>GRUNDY</strong><small>TEAM LOCKED</small></div></div>
        <div className={styles.championSlot}><span>★</span><small>CHAMPION</small><strong>— — —</strong></div>
      </section>
      <p className={styles.messageBox}>{message}</p>
      {menuOpen && (
        <div className={styles.menuShade} role="presentation">
          <section className={styles.contextMenu} aria-label="Match menu">
            <strong>MATCH MENU</strong>
            {menuItems.map((item, index) => <button className={menuSelection === index ? styles.contextSelected : undefined} key={item} onClick={() => onMenuActivate(index)} type="button">{menuSelection === index && <span>▶</span>}{item}</button>)}
          </section>
        </div>
      )}
    </div>
  )
}

function CardScreen({ selection, message, onActivate }: ScreenProps) {
  const rows = [['LEAGUE RECORD', '0 wins · 0 losses', '›'], ['SYSTEM SETTINGS', 'Sound · Haptics · Theme', '›']] as const
  return (
    <div className={styles.screenPage}>
      <header className={styles.screenTitle}><span>CARD</span><strong>TRAINER ID</strong><small>LOCAL</small></header>
      <section className={styles.trainerCard}><span>J</span><div><small>TRAINER</small><h2>JAMES</h2><p>@jamespyrz</p></div><b>PMB</b></section>
      <MenuRows onActivate={onActivate} rows={rows} selection={selection} />
      <p className={styles.messageBox}>{message}</p>
    </div>
  )
}

function MenuRows({ selection, rows, onActivate }: { selection: number; rows: readonly MenuRow[]; onActivate: (index: number) => void }) {
  return (
    <section className={styles.gameMenu} aria-label="Screen actions">
      {rows.map(([title, detail, marker], index) => (
        <button className={selection === index ? styles.selectedRow : undefined} key={title} onClick={() => onActivate(index)} type="button">
          {selection === index && <span className={styles.cursor} aria-hidden="true">▶</span>}
          <span><strong>{title}</strong><small>{detail}</small></span><b>{marker}</b>
        </button>
      ))}
    </section>
  )
}

function ControllerDeck({ canCycle, onA, onB, onDown, onLeft, onRight, onSelect, onShoulderLeft, onShoulderRight, onStart, onUp }: {
  canCycle: boolean; onA: () => void; onB: () => void; onDown: () => void; onLeft: () => void; onRight: () => void; onSelect: () => void; onShoulderLeft: () => void; onShoulderRight: () => void; onStart: () => void; onUp: () => void
}) {
  return (
    <footer className={styles.controllerDeck} aria-label="Trainer Gear controls">
      <div className={styles.shoulders}>
        <button disabled={!canCycle} onClick={onShoulderLeft} type="button"><b>L</b><span>Previous mode</span></button>
        <small>L / R MODE SELECT</small>
        <button disabled={!canCycle} onClick={onShoulderRight} type="button"><span>Next mode</span><b>R</b></button>
      </div>
      <div className={styles.controlBody}>
        <div className={styles.dpad} aria-label="Menu direction pad">
          <button aria-label="Move up" className={styles.dpadUp} onClick={onUp} type="button">▲</button>
          <button aria-label="Move left" className={styles.dpadLeft} onClick={onLeft} type="button">◀</button><i />
          <button aria-label="Move right" className={styles.dpadRight} onClick={onRight} type="button">▶</button>
          <button aria-label="Move down" className={styles.dpadDown} onClick={onDown} type="button">▼</button>
        </div>
        <div className={styles.systemKeys}>
          <button onClick={onSelect} type="button"><i />SELECT</button><button onClick={onStart} type="button"><i />START</button>
        </div>
        <div className={styles.faceButtons}>
          <button aria-label="Back" onClick={onB} type="button"><b>B</b><small>BACK</small></button>
          <button aria-label="Confirm selection" onClick={onA} type="button"><b>A</b><small>OK</small></button>
        </div>
      </div>
    </footer>
  )
}

function ControlHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.menuShade} role="presentation">
      <section className={styles.contextMenu} aria-label="Control guide">
        <strong>CONTROL GUIDE</strong>
        <p><b>L / R</b><span>Change mode</span></p><p><b>D-PAD</b><span>Move cursor</span></p><p><b>A</b><span>Confirm</span></p><p><b>B</b><span>Back</span></p>
        <button className={styles.contextSelected} onClick={onClose} type="button"><span>▶</span>Close</button>
      </section>
    </div>
  )
}
