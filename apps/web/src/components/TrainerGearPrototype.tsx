import { useState } from 'react'
import styles from './TrainerGearPrototype.module.scss'

type GearScreen = 'continue' | 'link' | 'cup'

const pikachuSprite = 'https://play.pokemonshowdown.com/sprites/ani/pikachu.gif'

export function TrainerGearPrototype() {
  const [screen, setScreen] = useState<GearScreen>('continue')
  const [menuOpen, setMenuOpen] = useState(false)

  if (screen === 'continue') {
    return (
      <main className={styles.prototype}>
        <section className={`${styles.gear} ${styles.bootGear}`} aria-label="Trainer Gear prototype">
          <header className={styles.hardwareTop}>
            <strong>PMB</strong>
            <span>TRAINER GEAR / 01</span>
            <i aria-label="Link connected" />
          </header>

          <div className={styles.bootScreen}>
            <div className={styles.bootMark} aria-hidden="true"><span /></div>
            <p className={styles.eyebrow}>Pocket Monster Brawl</p>
            <h1>TRAINER<br />GEAR</h1>
            <p className={styles.version}>SYSTEM 0.1 · LINK READY</p>

            <button className={styles.saveFile} onClick={() => setScreen('link')} type="button">
              <span className={styles.cursor} aria-hidden="true">▶</span>
              <img alt="Pikachu" src={pikachuSprite} />
              <span className={styles.saveDetails}>
                <small>CONTINUE</small>
                <strong>JAMES</strong>
                <span>Indigo Cup · Team locked</span>
              </span>
              <b>›</b>
            </button>
          </div>

          <footer className={styles.bootKeys}>
            <span><b>A</b> Continue</span>
            <span><b>＋</b> New player</span>
          </footer>
        </section>
      </main>
    )
  }

  return (
    <main className={styles.prototype}>
      <section className={styles.gear} aria-label="Trainer Gear prototype">
        <header className={styles.hardwareTop}>
          <strong>PMB</strong>
          <span>TRAINER GEAR / 01</span>
          <i aria-label="Link connected" />
        </header>

        <nav className={styles.modeTabs} aria-label="Trainer Gear modes">
          <button aria-current={screen === 'link' ? 'page' : undefined} onClick={() => setScreen('link')} type="button">
            <span>LK</span><small>LINK</small>
          </button>
          <button disabled type="button"><span>TM</span><small>TEAM</small></button>
          <button aria-current={screen === 'cup' ? 'page' : undefined} onClick={() => setScreen('cup')} type="button">
            <span>CP</span><small>CUP</small>
          </button>
          <button disabled type="button"><span>ID</span><small>CARD</small></button>
        </nav>

        <div className={styles.display}>
          {screen === 'link' ? (
            <LinkScreen onOpenCup={() => setScreen('cup')} />
          ) : (
            <CupScreen menuOpen={menuOpen} onMenuChange={setMenuOpen} />
          )}
        </div>

        <footer className={styles.softKeys}>
          <button onClick={() => setMenuOpen(screen === 'cup')} type="button"><b>A</b><span>Select</span></button>
          <button onClick={() => setScreen('continue')} type="button"><b>B</b><span>Back</span></button>
        </footer>
      </section>
    </main>
  )
}

function LinkScreen({ onOpenCup }: { onOpenCup: () => void }) {
  return (
    <div className={styles.screenPage}>
      <header className={styles.screenTitle}>
        <span>LINK</span>
        <strong>INDIGO CLUB</strong>
        <small>2 ONLINE</small>
      </header>

      <section className={styles.linkHero}>
        <div className={styles.partnerPane}>
          <span className={styles.levelTag}>PARTNER</span>
          <img alt="Pikachu" src={pikachuSprite} />
          <strong>PIKACHU</strong>
          <small>TEAM 01</small>
        </div>
        <div className={styles.clubPane}>
          <small>CURRENT LEAGUE</small>
          <h2>INDIGO<br />LINK CLUB</h2>
          <dl>
            <div><dt>TRAINERS</dt><dd>2 / 8</dd></div>
            <div><dt>YOUR ROLE</dt><dd>ADMIN</dd></div>
            <div><dt>LINK</dt><dd className={styles.online}>ONLINE</dd></div>
          </dl>
        </div>
      </section>

      <section className={styles.gameMenu} aria-label="Link Club actions">
        <button className={styles.selectedRow} onClick={onOpenCup} type="button">
          <span className={styles.cursor} aria-hidden="true">▶</span>
          <span><strong>TOURNAMENT BOARD</strong><small>Indigo Cup · Match ready</small></span>
          <b>!</b>
        </button>
        <button disabled type="button">
          <span><strong>TRAINER ROSTER</strong><small>2 registered trainers</small></span>
          <b>›</b>
        </button>
        <button disabled type="button">
          <span><strong>LINK REQUESTS</strong><small>No new invitations</small></span>
          <b>›</b>
        </button>
      </section>

      <p className={styles.messageBox}>A tournament match is waiting. Check the board when you are ready.</p>
    </div>
  )
}

function CupScreen({ menuOpen, onMenuChange }: { menuOpen: boolean; onMenuChange: (open: boolean) => void }) {
  return (
    <div className={styles.screenPage}>
      <header className={styles.screenTitle}>
        <span>CUP</span>
        <strong>INDIGO CUP</strong>
        <small>ROUND 1</small>
      </header>

      <section className={styles.matchPanel}>
        <div className={styles.roundLabel}><span>01</span><strong>NEXT MATCH</strong><small>BEST OF 3</small></div>
        <div className={styles.versus}>
          <div><i className={styles.trainerBall} /><strong>JAMES</strong><small>READY</small></div>
          <b>VS</b>
          <div><i className={styles.trainerBall} /><strong>GRUNDY</strong><small>READY</small></div>
        </div>
        <button className={styles.matchAction} onClick={() => onMenuChange(true)} type="button">
          <span className={styles.cursor} aria-hidden="true">▶</span>
          OPEN MATCH MENU
        </button>
      </section>

      <section className={styles.bracket} aria-label="Tournament bracket preview">
        <header><strong>BRACKET</strong><span>2 TRAINERS</span></header>
        <div className={styles.bracketLine}>
          <div><span>01</span><strong>JAMES</strong><small>TEAM LOCKED</small></div>
          <i />
          <div><span>02</span><strong>GRUNDY</strong><small>TEAM LOCKED</small></div>
        </div>
        <div className={styles.championSlot}><span>★</span><small>CHAMPION</small><strong>— — —</strong></div>
      </section>

      <p className={styles.messageBox}>Both trainers are ready. Open the match menu to begin.</p>

      {menuOpen && (
        <div className={styles.menuShade} onClick={() => onMenuChange(false)} role="presentation">
          <section className={styles.contextMenu} aria-label="Match menu" onClick={(event) => event.stopPropagation()}>
            <strong>MATCH MENU</strong>
            <button className={styles.contextSelected} type="button"><span>▶</span>Begin battle</button>
            <button type="button">View teams</button>
            <button type="button">Match rules</button>
            <button onClick={() => onMenuChange(false)} type="button">Cancel</button>
          </section>
        </div>
      )}
    </div>
  )
}
