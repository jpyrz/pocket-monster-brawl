import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import styles from './TrainerGearShell.module.scss'

export type GearMode = 'card' | 'box' | 'league' | 'cup'

type GearControls = {
  readonly up: () => void
  readonly down: () => void
  readonly left: () => void
  readonly right: () => void
  readonly confirm: () => void
  readonly back: () => void
  readonly start: () => void
  readonly select: () => void
}

type TrainerGearShellProps = {
  readonly children: ReactNode
  readonly mode?: GearMode
  readonly showTabs?: boolean
  readonly controls?: GearControls
  readonly battle?: boolean
}

const controllerPreferenceKey = 'pmb-controller-collapsed'
const modes: ReadonlyArray<{ id: GearMode; code: string; label: string; path: string }> = [
  { id: 'card', code: 'ID', label: 'CARD', path: '/app' },
  { id: 'box', code: 'BX', label: 'BOX', path: '/app/box' },
  { id: 'league', code: 'LG', label: 'LEAGUE', path: '/app/leagues' },
  { id: 'cup', code: 'CP', label: 'CUP', path: '/app/cups' },
]

function readControllerPreference() {
  try {
    return window.localStorage.getItem(controllerPreferenceKey) === 'true'
  } catch {
    return false
  }
}

function saveControllerPreference(collapsed: boolean) {
  try {
    window.localStorage.setItem(controllerPreferenceKey, String(collapsed))
  } catch {
    // The controls still work when private browsing blocks local storage.
  }
}

function isUsable(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
}

export function TrainerGearShell({ children, mode = 'card', showTabs = true, controls, battle = false }: TrainerGearShellProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const displayRef = useRef<HTMLDivElement>(null)
  const selectedElement = useRef<HTMLElement | null>(null)
  const [controllerCollapsed, setControllerCollapsed] = useState(readControllerPreference)
  const [focusRevision, setFocusRevision] = useState(0)

  const focusables = useCallback(() => {
    const display = displayRef.current
    if (!display) return []
    return Array.from(display.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).filter(isUsable)
  }, [])

  const selectElement = useCallback((element: HTMLElement | null, shouldScroll = true) => {
    if (selectedElement.current) selectedElement.current.removeAttribute('data-gear-focused')
    selectedElement.current = element
    if (!element) return
    element.setAttribute('data-gear-focused', 'true')
    if (shouldScroll) {
      element.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'nearest',
        inline: 'nearest',
      })
    }
  }, [])

  const moveFocus = useCallback((direction: -1 | 1) => {
    const elements = focusables()
    if (!elements.length) return
    const current = selectedElement.current ? elements.indexOf(selectedElement.current) : -1
    const next = current < 0 ? (direction > 0 ? 0 : elements.length - 1) : (current + direction + elements.length) % elements.length
    selectElement(elements[next] ?? null)
  }, [focusables, selectElement])

  const confirm = useCallback(() => {
    const elements = focusables()
    const current = selectedElement.current && elements.includes(selectedElement.current) ? selectedElement.current : elements[0]
    if (!current) return
    selectElement(current)
    if (current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement || current instanceof HTMLSelectElement) {
      current.focus()
      if (current instanceof HTMLInputElement && current.type === 'file') current.click()
      return
    }
    current.click()
  }, [focusables, selectElement])

  const goBack = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
      active.blur()
      return
    }
    const match = location.pathname.match(/^\/leagues\/([^/]+)\/tournaments\//)
    if (match) navigate(`/leagues/${match[1]}`)
    else if (location.pathname.startsWith('/leagues/')) navigate('/app/leagues')
    else if (location.pathname !== '/app' && location.pathname !== '/welcome') navigate('/app')
  }, [location.pathname, navigate])

  const appControls: GearControls = {
    up: () => moveFocus(-1),
    down: () => moveFocus(1),
    left: () => moveFocus(-1),
    right: () => moveFocus(1),
    confirm,
    back: goBack,
    start: () => navigate('/app'),
    select: () => navigate('/app/inbox'),
  }
  const activeControls = controls ?? appControls

  const chooseMode = useCallback((nextMode: GearMode) => {
    const target = modes.find((item) => item.id === nextMode)
    if (target) navigate(target.path)
  }, [navigate])

  const cycleMode = useCallback((direction: -1 | 1) => {
    if (!showTabs) return
    const current = modes.findIndex((item) => item.id === mode)
    chooseMode(modes[(current + direction + modes.length) % modes.length]!.id)
  }, [chooseMode, mode, showTabs])

  function toggleController() {
    setControllerCollapsed((collapsed) => {
      const next = !collapsed
      saveControllerPreference(next)
      return next
    })
  }

  useEffect(() => {
    selectElement(null, false)
  }, [location.pathname, selectElement])

  useEffect(() => {
    if (controls) return
    const display = displayRef.current
    if (!display) return
    const onClick = (event: MouseEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')
      if (target && display.contains(target)) selectElement(target, false)
    }
    const observer = new MutationObserver(() => setFocusRevision((revision) => revision + 1))
    observer.observe(display, { childList: true, subtree: true })
    display.addEventListener('click', onClick)
    return () => {
      observer.disconnect()
      display.removeEventListener('click', onClick)
    }
  }, [controls, selectElement])

  useEffect(() => {
    if (controls || selectedElement.current) return
    selectElement(focusables()[0] ?? null, false)
  }, [controls, focusRevision, focusables, selectElement])

  return (
    <main className={styles.stage}>
      <section className={`${styles.gear} ${!showTabs ? styles.noTabs : ''} ${battle ? styles.battleGear : ''}`} aria-label={battle ? 'Trainer Gear battle console' : 'Trainer Gear'}>
        <header className={styles.hardwareTop}>
          <span>{battle ? 'BATTLE' : 'TRAINER GEAR / 02'}</span><i aria-label="Server connected" />
        </header>

        {showTabs && <nav className={styles.modeTabs} aria-label="Trainer Gear modes">
          {modes.map((item) => (
            <button aria-current={mode === item.id ? 'page' : undefined} key={item.id} onClick={() => chooseMode(item.id)} type="button">
              <span>{item.code}</span><small>{item.label}</small>
            </button>
          ))}
        </nav>}

        <div className={styles.display} ref={displayRef}>{children}</div>

        {controllerCollapsed ? (
          <footer className={styles.collapsedController} aria-label="Touch controls mode">
            <button aria-label="Show controller" onClick={toggleController} type="button"><span aria-hidden="true">▲</span></button>
          </footer>
        ) : (
          <ControllerDeck
            canCycle={showTabs}
            controls={activeControls}
            onCollapse={toggleController}
            onShoulderLeft={() => cycleMode(-1)}
            onShoulderRight={() => cycleMode(1)}
          />
        )}
      </section>
    </main>
  )
}

function ControllerDeck({ canCycle, controls, onCollapse, onShoulderLeft, onShoulderRight }: {
  canCycle: boolean
  controls: GearControls
  onCollapse: () => void
  onShoulderLeft: () => void
  onShoulderRight: () => void
}) {
  return (
    <footer className={styles.controllerDeck} aria-label="Trainer Gear controls">
      <div className={styles.shoulders}>
        <button aria-label="Previous mode" className={styles.shoulderButton} disabled={!canCycle} onClick={onShoulderLeft} type="button"><b>L</b></button>
        <button aria-label="Hide controller" className={styles.collapseButton} onClick={onCollapse} type="button"><span aria-hidden="true">▼</span></button>
        <button aria-label="Next mode" className={styles.shoulderButton} disabled={!canCycle} onClick={onShoulderRight} type="button"><b>R</b></button>
      </div>
      <div className={styles.controlBody}>
        <div className={styles.dpad} aria-label="Menu direction pad">
          <button aria-label="Move up" className={styles.dpadUp} onClick={controls.up} type="button">▲</button>
          <button aria-label="Move left" className={styles.dpadLeft} onClick={controls.left} type="button">◀</button><i />
          <button aria-label="Move right" className={styles.dpadRight} onClick={controls.right} type="button">▶</button>
          <button aria-label="Move down" className={styles.dpadDown} onClick={controls.down} type="button">▼</button>
        </div>
        <div className={styles.systemKeys}>
          <button onClick={controls.select} type="button"><i />SELECT</button><button onClick={controls.start} type="button"><i />START</button>
        </div>
        <div className={styles.faceButtons}>
          <button aria-label="Back" onClick={controls.back} type="button"><b>B</b></button>
          <button aria-label="Confirm selection" onClick={controls.confirm} type="button"><b>A</b></button>
        </div>
      </div>
    </footer>
  )
}
