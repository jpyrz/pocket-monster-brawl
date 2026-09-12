import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import type { GameProfile } from '@pmb/domain'
import { SaveImport } from './components/SaveImport'
import { SkinLab } from './components/SkinLab'
import { AuthPage, Dashboard, LeaguePage, TournamentTeamPage } from './components/ProductFlow'
import { useSession } from './components/productApi'
import styles from './App.module.scss'

type ProfilesResponse = { profiles: GameProfile[] }

async function getProfiles(): Promise<ProfilesResponse> {
  const response = await fetch('/api/profiles')
  if (!response.ok) throw new Error('The local API is not available.')
  return response.json() as Promise<ProfilesResponse>
}

function Home() {
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: getProfiles, retry: false })

  return (
    <main>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>Friends league · early build</p>
        <h1>Train anywhere.<br />Brawl together.</h1>
        <p className={styles.lede}>
          Bring a team from your own game save, lock it for the season, and play a manual
          browser battle governed by the league’s rules.
        </p>
        <div className={styles.actions}>
          <Link className={styles.primaryAction} to="/welcome">Create your league</Link>
          <Link className={styles.secondaryAction} to="/skin-lab">Enter the demo battle</Link>
        </div>
      </section>

      <section className={styles.foundation} id="foundation">
        <div>
          <p className={styles.eyebrow}>Playable LAN foundation</p>
          <h2>Real saves. Private teams. Real matches.</h2>
          <p>
            Import a FireRed save, lock a private team, and battle another signed-in player
            through the server-owned Pokémon Showdown engine.
          </p>
        </div>
        <div className={styles.statusGrid}>
          <article>
            <span>01</span>
            <h3>Profile registry</h3>
            <p>Versioned FireRed/Gen III configuration with a separate Gen II test fixture.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Skin adapter</h3>
            <p>One coordinate system drives the viewport, touch regions, and accessible controls.</p>
          </article>
          <article>
            <span>03</span>
            <h3>PKHeX import</h3>
            <p>Validated 128 KiB saves are parsed locally into party, box, move, and stat data.</p>
          </article>
        </div>
      </section>

      <section className={styles.profileStrip} aria-labelledby="profile-heading">
        <div>
          <p className={styles.eyebrow}>Enabled game profile</p>
          <h2 id="profile-heading">
            {profiles.data?.profiles[0]?.name ?? 'FireRed · Generation III'}
          </h2>
        </div>
        <p className={styles.connection} data-state={profiles.status}>
          <span aria-hidden="true" />
          {profiles.isPending && 'Checking local API'}
          {profiles.isSuccess && 'Local API connected'}
          {profiles.isError && 'Run npm run dev to connect the API'}
        </p>
      </section>
    </main>
  )
}

function App() {
  const location = useLocation()
  const session = useSession()
  const queryClient = useQueryClient()
  const isControllerRoute = location.pathname === '/skin-lab' || location.pathname.startsWith('/matches/')

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    queryClient.setQueryData(['session'], null)
    window.location.assign('/welcome')
  }

  return (
    <div className={`${styles.app} ${isControllerRoute ? styles.controllerRoute : ''}`}>
      <header className={styles.header}>
        <Link className={styles.brand} to="/" aria-label="Pocket Monster Brawl home">
          <span className={styles.brandMark} aria-hidden="true">PM</span>
          <span>Pocket Monster Brawl</span>
        </Link>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end>Home</NavLink>
          {session.data ? <NavLink to="/app">Leagues</NavLink> : <NavLink to="/welcome">Sign in</NavLink>}
          <NavLink to="/skin-lab">Demo battle</NavLink>
          {session.data && <button className={styles.navButton} onClick={logout}>Sign out</button>}
        </nav>
      </header>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/welcome" element={<AuthPage />} />
        <Route path="/app" element={<Dashboard />} />
        <Route path="/leagues/:leagueId" element={<LeaguePage />} />
        <Route path="/leagues/:leagueId/tournaments/:tournamentId/team" element={<TournamentTeamPage />} />
        <Route path="/imports/new" element={<SaveImport />} />
        <Route path="/skin-lab" element={<SkinLab />} />
        <Route path="/matches/:battleId" element={<SkinLab />} />
      </Routes>

      <footer className={styles.footer}>
        <p>Self-hosted LAN app · raw saves are parsed locally, never retained, and never changed.</p>
      </footer>
    </div>
  )
}

export default App
