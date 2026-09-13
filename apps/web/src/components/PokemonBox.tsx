import { useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import type {
  BoxPokemonView,
  BoxTeamDraftWorkspaceView,
  ImportedPokemon,
  LockedTeamView,
  PokemonBoxView,
  SaveImportView,
  StatBlock,
  TournamentView,
  TrainerCardView,
} from '@pmb/domain'
import { createClientUuid } from './clientUuid'
import { productApi as api, useSession } from './productApi'
import styles from './PokemonBox.module.scss'

const fireRedSaveSize = 128 * 1024
const statLabels: ReadonlyArray<[keyof StatBlock, string]> = [
  ['hp', 'HP'], ['attack', 'Atk'], ['defense', 'Def'], ['specialAttack', 'SpA'], ['specialDefense', 'SpD'], ['speed', 'Spe'],
]

function showdownId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function PokemonSprite({ pokemon, animated = false }: { pokemon: ImportedPokemon; animated?: boolean }) {
  const [fallback, setFallback] = useState(false)
  const folder = animated && !fallback ? (pokemon.shiny ? 'ani-shiny' : 'ani') : (pokemon.shiny ? 'gen5-shiny' : 'gen5')
  return (
    <img
      alt={`${pokemon.shiny ? 'Shiny ' : ''}${pokemon.species}`}
      onError={() => setFallback(true)}
      src={`https://play.pokemonshowdown.com/sprites/${folder}/${showdownId(pokemon.species)}.${animated && !fallback ? 'gif' : 'png'}`}
    />
  )
}

function sourceLabel(entry: BoxPokemonView) {
  const source = entry.pokemon.source
  if (source.kind === 'party') return 'Party'
  return source.boxName ?? `Box ${source.box}`
}

function StatGrid({ label, stats }: { label: string; stats: StatBlock }) {
  return (
    <div className={styles.statGrid}>
      <strong>{label}</strong>
      {statLabels.map(([key, short]) => <span key={key}><small>{short}</small><b>{stats[key]}</b></span>)}
    </div>
  )
}

function PokemonDetail({ entry, partnerId, onChoosePartner, partnerPending }: {
  entry: BoxPokemonView
  partnerId?: string
  onChoosePartner: (snapshotId: string) => void
  partnerPending: boolean
}) {
  const pokemon = entry.pokemon
  const name = pokemon.nickname || pokemon.species
  return (
    <section className={styles.detailPanel} aria-label={`${name} details`}>
      <header>
        <div><small>{entry.game} · {sourceLabel(entry)}</small><h2>{name}</h2><p>{pokemon.species} · No. {String(pokemon.speciesId).padStart(3, '0')}</p></div>
        <span>Lv.{pokemon.level}</span>
      </header>
      <div className={styles.detailIdentity}>
        <div className={styles.previewSprite}><PokemonSprite animated pokemon={pokemon} />{pokemon.shiny && <b>SHINY</b>}</div>
        <dl>
          <div><dt>Nature</dt><dd>{pokemon.nature}</dd></div>
          <div><dt>Ability</dt><dd>{pokemon.ability}</dd></div>
          <div><dt>Held item</dt><dd>{pokemon.heldItem ?? 'None'}</dd></div>
          <div><dt>Friendship</dt><dd>{pokemon.friendship}</dd></div>
          <div><dt>Experience</dt><dd>{pokemon.experience.toLocaleString()}</dd></div>
          <div><dt>Gender</dt><dd>{pokemon.gender || '—'}</dd></div>
        </dl>
      </div>
      <div className={styles.movesPanel}>
        {pokemon.moves.map((move) => <div key={move.slot}><strong>{move.name}</strong><small>PP {move.pp}{move.ppUps ? ` · +${move.ppUps}` : ''}</small></div>)}
        {!pokemon.moves.length && <p>No moves found</p>}
      </div>
      <div className={styles.statsPanel}>
        <StatGrid label="Stats" stats={pokemon.stats} />
        {pokemon.storedStats && <StatGrid label="Stored stats" stats={pokemon.storedStats} />}
        <StatGrid label="IVs" stats={pokemon.ivs} />
        <StatGrid label="EVs" stats={pokemon.evs} />
      </div>
      {pokemon.legalityReport && <details className={styles.legalityReport}>
        <summary>{pokemon.legalityValid ? 'Legality report' : 'Why this Pokémon needs review'}</summary>
        <p>{pokemon.legalityReport}</p>
      </details>}
      <footer>
        <span>{pokemon.entityValid ? 'Valid data' : 'Invalid data'} · {pokemon.legalityValid ? '✓ Legal' : 'Review needed'} · {entry.filename}</span>
        <button disabled={partnerPending || partnerId === entry.snapshotId} onClick={() => onChoosePartner(entry.snapshotId)} type="button">
          {partnerId === entry.snapshotId ? 'Current partner' : 'Choose partner'}
        </button>
      </footer>
    </section>
  )
}

async function importResponse(response: Response): Promise<SaveImportView> {
  const body = await response.json() as SaveImportView | { error?: string }
  if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'The save could not be imported.')
  return body as SaveImportView
}

async function recoverImport(uploadId: string): Promise<SaveImportView> {
  await new Promise((resolve) => window.setTimeout(resolve, 750))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`/api/save-imports/${uploadId}`, { cache: 'no-store' })
      if (response.ok || response.status !== 404) return importResponse(response)
    } catch {
      // Mobile Wi-Fi can briefly drop while the parser finishes; retry within the overall timeout.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500))
  }
  throw new Error('The save reached the server, but the completed import could not be retrieved. Try again.')
}

function BoxImportPanel({ onImported }: { onImported: (result: SaveImportView) => void }) {
  const inputId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || pending) return
    setPending(true)
    setError('')
    const uploadId = createClientUuid()
    const controller = new AbortController()
    let timeoutId: number | undefined
    try {
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength !== fireRedSaveSize) throw new Error('FireRed saves must be exactly 128 KiB.')
      const upload = fetch('/api/save-imports/fire-red', {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-upload-id': uploadId },
        body: bytes,
        cache: 'no-store',
        signal: controller.signal,
      }).then(importResponse)
      const timeout = new Promise<SaveImportView>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('The save import timed out. Check the Wi-Fi connection and try again.')), 15_000)
      })
      const imported = await Promise.race([upload, recoverImport(uploadId), timeout])
      setFile(null)
      onImported(imported)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The save could not be imported.')
    } finally {
      controller.abort()
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      setPending(false)
    }
  }

  const valid = file?.name.toLowerCase().endsWith('.sav') === true && file.size === fireRedSaveSize
  return (
    <form className={styles.importPanel} onSubmit={submit}>
      <div><span>FR</span><p><strong>FireRed save</strong><small>More game adapters will appear here as they are verified.</small></p></div>
      <label htmlFor={inputId}><strong>{file ? 'Change save' : 'Choose save'}</strong><small>{file?.name ?? 'Analogue Pocket .sav · 128 KiB'}</small></label>
      <input accept=".sav,application/octet-stream" id={inputId} onChange={(event) => {
        const next = event.target.files?.[0] ?? null
        setFile(next)
        setError(next && (!next.name.toLowerCase().endsWith('.sav') || next.size !== fireRedSaveSize) ? 'Choose a raw 128 KiB FireRed .sav file.' : '')
      }} type="file" />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <button disabled={!valid || pending}>{pending ? 'Reading save…' : 'Import to Box'}</button>
      <small>Raw save discarded after parsing · source file unchanged</small>
    </form>
  )
}

export function PokemonBoxPage() {
  const session = useSession()
  const queryClient = useQueryClient()
  const box = useQuery({ queryKey: ['box'], queryFn: () => api<PokemonBoxView>('/api/box') })
  const trainerCard = useQuery({ queryKey: ['trainer-card'], queryFn: () => api<TrainerCardView>('/api/trainer-card') })
  const [importOpen, setImportOpen] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [partnerPending, setPartnerPending] = useState(false)
  const [message, setMessage] = useState('')

  const profiles = useMemo(() => [...new Map((box.data?.imports ?? []).map((item) => [item.profileId, item])).values()], [box.data])
  const visible = useMemo(() => (box.data?.pokemon ?? []).filter((item) => filter === 'all' || item.profileId === filter), [box.data, filter])
  const selected = visible.find((item) => item.snapshotId === selectedId) ?? visible[0] ?? null

  if (session.isPending) return <main className={styles.loading}>Opening Box…</main>
  if (!session.data) return <Navigate to="/welcome" replace />

  async function choosePartner(snapshotId: string) {
    setPartnerPending(true)
    setMessage('')
    try {
      const updated = await api<TrainerCardView>('/api/trainer-card', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ partnerPokemonSnapshotId: snapshotId }),
      })
      queryClient.setQueryData(['trainer-card'], updated)
      setMessage(`${updated.partner?.pokemon.nickname || updated.partner?.pokemon.species} is now your partner.`)
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Your partner could not be changed.')
    } finally {
      setPartnerPending(false)
    }
  }

  return (
    <main className={styles.workspace}>
      <header className={styles.screenHeader}><div><h1>Pokémon Box</h1><p>{box.data?.pokemon.length ?? 0} stored Pokémon</p></div><button onClick={() => setImportOpen((open) => !open)} type="button">{importOpen ? 'Close' : '+ Import'}</button></header>
      {importOpen && <BoxImportPanel onImported={(result) => {
        setImportOpen(false)
        setFilter(result.profileId)
        setMessage(`${result.pokemon.length} Pokémon added from ${result.game}.`)
        void queryClient.invalidateQueries({ queryKey: ['box'] })
      }} />}
      {message && <p className={styles.notice}>{message}</p>}
      {profiles.length > 0 && <nav className={styles.boxFilters} aria-label="Box game filters">
        <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')} type="button">All</button>
        {profiles.map((profile) => <button aria-pressed={filter === profile.profileId} key={profile.profileId} onClick={() => setFilter(profile.profileId)} type="button">{profile.game.replace('Pokemon ', '')}</button>)}
      </nav>}
      {box.isPending ? <div className={styles.loading}>Reading storage…</div> : box.error ? <p className={styles.error}>{box.error.message}</p> : visible.length ? <>
        <section className={styles.boxGrid} aria-label="Stored Pokémon">
          {visible.map((entry) => <button aria-pressed={selected?.snapshotId === entry.snapshotId} key={entry.snapshotId} onClick={() => setSelectedId(entry.snapshotId)} type="button">
            <PokemonSprite pokemon={entry.pokemon} /><span>{entry.pokemon.nickname || entry.pokemon.species}</span><small>Lv.{entry.pokemon.level}</small>
          </button>)}
        </section>
        {selected && <PokemonDetail entry={selected} onChoosePartner={choosePartner} partnerId={trainerCard.data?.partner?.snapshotId} partnerPending={partnerPending} />}
      </> : <section className={styles.empty}><b>BOX 01</b><strong>No Pokémon stored</strong><p>Import a supported save to build your collection.</p><button onClick={() => setImportOpen(true)} type="button">Import save</button></section>}
    </main>
  )
}

export function TournamentTeamBuilder({ tournament }: { tournament: TournamentView }) {
  const queryClient = useQueryClient()
  const workspace = useQuery({
    queryKey: ['box-team-draft', tournament.id],
    queryFn: () => api<BoxTeamDraftWorkspaceView>(`/api/tournaments/${tournament.id}/box-team-draft`),
  })
  const locked = useQuery({
    queryKey: ['team-lock', tournament.id],
    queryFn: async () => {
      const response = await fetch(`/api/tournaments/${tournament.id}/team-lock`)
      if (response.status === 404) return null
      const body = await response.json() as LockedTeamView | { error?: string }
      if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'Team lock could not be loaded.')
      return body as LockedTeamView
    },
    retry: false,
  })
  const [selectionOverride, setSelection] = useState<string[] | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')

  const entries = workspace.data?.eligiblePokemon ?? []
  const draftSelection = [...(workspace.data?.draftPokemonSnapshotIds ?? [])]
  const selection = selectionOverride ?? draftSelection
  const draftIsCurrent = selection.length === draftSelection.length && selection.every((id, index) => id === draftSelection[index])

  function toggle(snapshotId: string) {
    if (locked.data) return
    setMessage('')
    setSelection((current) => {
      const active = current ?? draftSelection
      return active.includes(snapshotId)
        ? active.filter((id) => id !== snapshotId)
        : active.length < tournament.rules.teamSize ? [...active, snapshotId] : active
    })
  }

  function move(index: number, direction: -1 | 1) {
    if (locked.data) return
    setSelection((current) => {
      const active = current ?? draftSelection
      const target = index + direction
      if (target < 0 || target >= active.length) return active
      const next = [...active]
      ;[next[index], next[target]] = [next[target]!, next[index]!]
      return next
    })
  }

  async function saveDraft() {
    setPending(true)
    setMessage('')
    try {
      const saved = await api<BoxTeamDraftWorkspaceView>(`/api/tournaments/${tournament.id}/box-team-draft`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pokemonSnapshotIds: selection }),
      })
      queryClient.setQueryData(['box-team-draft', tournament.id], saved)
      setMessage('Private team draft saved.')
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The team draft could not be saved.')
    } finally {
      setPending(false)
    }
  }

  async function lockTeam() {
    setPending(true)
    setMessage('')
    try {
      const result = await api<LockedTeamView>(`/api/tournaments/${tournament.id}/team-lock`, { method: 'POST' })
      queryClient.setQueryData(['team-lock', tournament.id], result)
      setMessage('Team locked for the tournament.')
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'The team could not be locked.')
    } finally {
      setPending(false)
    }
  }

  if (workspace.isPending || locked.isPending) return <div className={styles.loading}>Checking your Box…</div>
  if (workspace.error) return <p className={styles.error}>{workspace.error.message}</p>
  if (!entries.length) return <section className={styles.noEligible}><strong>No eligible Pokémon</strong><p>Import a save supported by this tournament before building your team.</p><Link to="/app/box">Open Pokémon Box</Link></section>

  return (
    <section className={styles.teamBuilder}>
      <header><div><small>Private tournament team</small><h2>Choose your team</h2><p>{entries.length} eligible Pokémon · up to {tournament.rules.teamSize}</p></div><b>{selection.length}/{tournament.rules.teamSize}</b></header>
      {selection.length > 0 && <ol className={styles.teamOrder}>{selection.map((id, index) => {
        const entry = entries.find((item) => item.snapshotId === id)
        if (!entry) return null
        return <li key={id}><span>{index === 0 ? 'Lead' : index + 1}</span><PokemonSprite pokemon={entry.pokemon} /><strong>{entry.pokemon.nickname || entry.pokemon.species}</strong><div><button disabled={index === 0 || Boolean(locked.data)} onClick={() => move(index, -1)} type="button">↑</button><button disabled={index === selection.length - 1 || Boolean(locked.data)} onClick={() => move(index, 1)} type="button">↓</button></div></li>
      })}</ol>}
      <div className={styles.teamPicker}>{entries.map((entry) => {
        const selected = selection.includes(entry.snapshotId)
        const unusable = entry.pokemon.egg || !entry.pokemon.entityValid || !entry.pokemon.legalityValid || !entry.pokemon.moves.length
        return <button aria-pressed={selected} disabled={Boolean(locked.data) || unusable || (!selected && selection.length >= tournament.rules.teamSize)} key={entry.snapshotId} onClick={() => toggle(entry.snapshotId)} type="button"><PokemonSprite pokemon={entry.pokemon} /><span><strong>{entry.pokemon.nickname || entry.pokemon.species}</strong><small>Lv.{entry.pokemon.level} · {entry.game.replace('Pokemon ', '')}</small></span><b>{selected ? '✓' : '+'}</b></button>
      })}</div>
      {message && <p className={styles.notice}>{message}</p>}
      <footer className={styles.teamActions}>
        {locked.data ? <strong>✓ Team locked · {locked.data.pokemonCount} Pokémon</strong> : <>
          <button disabled={!selection.length || pending || draftIsCurrent} onClick={saveDraft} type="button">{pending ? 'Saving…' : 'Save draft'}</button>
          <button disabled={!workspace.data?.draft || !draftIsCurrent || pending} onClick={lockTeam} type="button">Lock team</button>
        </>}
      </footer>
    </section>
  )
}
