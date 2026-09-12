import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { SaveImport } from './components/SaveImport'
import { SkinLab } from './components/SkinLab'
import { AuthPage, Dashboard, InvitationsPage, LeaguePage, PlayerPage, TournamentTeamPage } from './components/ProductFlow'
import { GameIcon } from './components/GameIcon'
import { useSession } from './components/productApi'
import styles from './App.module.scss'

function Launch() {
  const session = useSession()
  if (session.isPending) return <main className={styles.boot}><span>PM</span><p>Connecting…</p></main>
  return <Navigate to={session.data ? '/app' : '/welcome'} replace />
}

function App() {
  const location = useLocation()
  const session = useSession()
  const isControllerRoute = location.pathname === '/skin-lab' || location.pathname.startsWith('/matches/')
  const showShell = Boolean(session.data) && !isControllerRoute

  return (
    <div className={`${styles.app} ${isControllerRoute ? styles.controllerRoute : ''} ${showShell ? styles.hasShell : ''}`}>
      {showShell && <header className={styles.header}>
        <NavLink className={styles.brand} to="/app" aria-label="Pocket Monster Brawl leagues">
          <span className={styles.brandMark} aria-hidden="true">PM</span>
          <span><strong>POCKET MONSTER BRAWL</strong><small>LOCAL LINK ONLINE</small></span>
        </NavLink>
        <nav className={styles.desktopNav} aria-label="Primary navigation">
          <NavLink className={location.pathname.startsWith('/leagues/') ? styles.activeNav : undefined} to="/app" end>Leagues</NavLink>
          <NavLink to="/app/invitations">Invites</NavLink>
          <NavLink to="/app/player">Player</NavLink>
        </nav>
      </header>}

      <Routes>
        <Route path="/" element={<Launch />} />
        <Route path="/welcome" element={<AuthPage />} />
        <Route path="/app" element={<Dashboard />} />
        <Route path="/app/invitations" element={<InvitationsPage />} />
        <Route path="/app/player" element={<PlayerPage />} />
        <Route path="/leagues/:leagueId" element={<LeaguePage />} />
        <Route path="/leagues/:leagueId/tournaments/:tournamentId/team" element={<TournamentTeamPage />} />
        <Route path="/imports/new" element={<SaveImport />} />
        <Route path="/skin-lab" element={<SkinLab />} />
        <Route path="/matches/:battleId" element={<SkinLab />} />
      </Routes>

      {showShell && <nav className={styles.mobileNav} aria-label="App navigation">
        <NavLink className={location.pathname.startsWith('/leagues/') ? styles.activeNav : undefined} to="/app" end><GameIcon name="league" /><span>Leagues</span></NavLink>
        <NavLink to="/app/invitations"><GameIcon name="mail" /><span>Invites</span></NavLink>
        <NavLink to="/app/player"><GameIcon name="player" /><span>Player</span></NavLink>
      </nav>}
    </div>
  )
}

export default App
