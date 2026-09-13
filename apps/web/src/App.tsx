import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { SkinLab } from './components/SkinLab'
import { AuthPage, CupsPage, Dashboard, InvitationsPage, LeaguePage, PlayerPage, TournamentTeamPage } from './components/ProductFlow'
import { PokemonBoxPage } from './components/PokemonBox'
import { TrainerGearPrototype } from './components/TrainerGearPrototype'
import { TrainerGearShell, type GearMode } from './components/TrainerGearShell'
import { useSession } from './components/productApi'
import styles from './App.module.scss'

function Launch() {
  const session = useSession()
  if (session.isPending) return <main className={styles.boot}><span>PM</span><p>Connecting…</p></main>
  return <Navigate to={session.data ? '/app' : '/welcome'} replace />
}

function App() {
  const location = useLocation()
  const isBattleRoute = location.pathname === '/skin-lab' || location.pathname.startsWith('/matches/')
  const isPrototypeRoute = location.pathname === '/gear-lab'
  const showTabs = location.pathname !== '/' && location.pathname !== '/welcome'
  const mode: GearMode = location.pathname === '/app/box'
    ? 'box'
    : location.pathname === '/app/cups' || location.pathname.includes('/tournaments/')
      ? 'cup'
      : location.pathname === '/app/leagues' || location.pathname === '/app/inbox' || location.pathname === '/app/invitations' || location.pathname.startsWith('/leagues/')
        ? 'league'
        : 'card'

  const routes = <Routes>
    <Route path="/" element={<Launch />} />
    <Route path="/welcome" element={<AuthPage />} />
    <Route path="/app" element={<PlayerPage />} />
    <Route path="/app/box" element={<PokemonBoxPage />} />
    <Route path="/app/leagues" element={<Dashboard />} />
    <Route path="/app/inbox" element={<InvitationsPage />} />
    <Route path="/app/invitations" element={<Navigate to="/app/inbox" replace />} />
    <Route path="/app/cups" element={<CupsPage />} />
    <Route path="/app/player" element={<Navigate to="/app" replace />} />
    <Route path="/leagues/:leagueId" element={<LeaguePage />} />
    <Route path="/leagues/:leagueId/tournaments/:tournamentId/team" element={<TournamentTeamPage />} />
    <Route path="/imports/new" element={<Navigate to="/app/box" replace />} />
    <Route path="/skin-lab" element={<SkinLab />} />
    <Route path="/gear-lab" element={<TrainerGearPrototype />} />
    <Route path="/matches/:battleId" element={<SkinLab />} />
  </Routes>

  if (isBattleRoute || isPrototypeRoute) return <div className={styles.app}>{routes}</div>
  return <div className={styles.app}><TrainerGearShell mode={mode} showTabs={showTabs}>{routes}</TrainerGearShell></div>
}

export default App
