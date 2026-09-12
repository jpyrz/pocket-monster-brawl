import { useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ImportedPokemon, LockedTeamView, RegisteredTeamView, SaveImportView, StatBlock, TeamDraftView, TeamDraftWorkspaceView, TournamentView } from '@pmb/domain'
import { createClientUuid } from './clientUuid'
import styles from './SaveImport.module.scss'

const fireRedSaveSize = 128 * 1024

type ImportStatus = 'idle' | 'ready' | 'importing' | 'success' | 'error'

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))
}

async function importResponse(response: Response): Promise<SaveImportView> {
  const body = await response.json() as SaveImportView | { error?: string }
  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : 'The save could not be imported.')
  }
  return body as SaveImportView
}

async function recoverImport(tournamentId: string, uploadId: string): Promise<SaveImportView> {
  await wait(750)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const response = await fetch(`/api/tournaments/${tournamentId}/save-imports/${uploadId}`, { cache: 'no-store' })
      if (response.ok) return importResponse(response)
      if (response.status !== 404) return importResponse(response)
    } catch {
      // A transient mobile-network failure is retried until the overall import timeout wins.
    }
    await wait(500)
  }
  throw new Error('The save reached the server, but the completed import could not be retrieved. Try again.')
}

const statLabels: ReadonlyArray<[keyof StatBlock, string]> = [
  ['hp', 'HP'],
  ['attack', 'Atk'],
  ['defense', 'Def'],
  ['specialAttack', 'SpA'],
  ['specialDefense', 'SpD'],
  ['speed', 'Spe'],
]

function showdownId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function locationLabel(pokemon: ImportedPokemon) {
  if (pokemon.source.kind === 'party') return `Party · slot ${pokemon.source.slot}`
  return `${pokemon.source.boxName ?? `Box ${pokemon.source.box}`} · slot ${pokemon.source.slot}`
}

function StatRow({ label, stats }: { label: string; stats: StatBlock }) {
  return (
    <div className={styles.statRow}>
      <strong>{label}</strong>
      {statLabels.map(([key, shortLabel]) => (
        <span key={key} title={shortLabel}>
          <small>{shortLabel}</small>
          {stats[key]}
        </span>
      ))}
    </div>
  )
}

function PokemonCard({
  pokemon,
  selected,
  selectionDisabled,
  onToggle,
}: {
  pokemon: ImportedPokemon
  selected: boolean
  selectionDisabled: boolean
  onToggle: () => void
}) {
  const displayName = pokemon.nickname || pokemon.species
  const nicknameDiffers = displayName.toLocaleLowerCase() !== pokemon.species.toLocaleLowerCase()

  return (
    <article className={`${styles.pokemonCard} ${selected ? styles.selectedCard : ''}`}>
      <div className={styles.pokemonTopline}>
        <span>{locationLabel(pokemon)}</span>
        <div>
          <span className={pokemon.legalityValid ? styles.valid : styles.invalid}>
            {pokemon.legalityValid ? 'PKHeX valid' : 'Review needed'}
          </span>
          <button
            aria-pressed={selected}
            disabled={selectionDisabled}
            onClick={onToggle}
            type="button"
          >
            {selected ? 'Selected' : 'Add to team'}
          </button>
        </div>
      </div>

      <div className={styles.pokemonIdentity}>
        <div className={styles.spriteStage}>
          <img
            alt={`${pokemon.species} Generation III sprite`}
            src={`https://play.pokemonshowdown.com/sprites/gen3/${showdownId(pokemon.species)}.png`}
          />
          {pokemon.shiny && <span>Shiny</span>}
        </div>
        <div>
          <p>Level {pokemon.level} · {pokemon.gender || '—'}</p>
          <h3>{displayName}</h3>
          {nicknameDiffers && <span className={styles.speciesName}>{pokemon.species}</span>}
          <dl className={styles.traits}>
            <div><dt>Nature</dt><dd>{pokemon.nature}</dd></div>
            <div><dt>Ability</dt><dd>{pokemon.ability}</dd></div>
            <div><dt>Held item</dt><dd>{pokemon.heldItem ?? 'None'}</dd></div>
          </dl>
        </div>
      </div>

      <div className={styles.moves} aria-label={`${displayName}'s moves`}>
        {pokemon.moves.map((move) => (
          <div key={move.slot}>
            <strong>{move.name}</strong>
            <span>PP {move.pp}{move.ppUps > 0 ? ` · +${move.ppUps}` : ''}</span>
          </div>
        ))}
        {pokemon.moves.length === 0 && <p>No moves found</p>}
      </div>

      <details className={styles.trainingDetails}>
        <summary>Stats and training values</summary>
        <div>
          <StatRow label="Stats" stats={pokemon.stats} />
          <StatRow label="IVs" stats={pokemon.ivs} />
          <StatRow label="EVs" stats={pokemon.evs} />
        </div>
        {!pokemon.legalityValid && pokemon.legalityReport && (
          <pre>{pokemon.legalityReport}</pre>
        )}
      </details>
    </article>
  )
}

export function SaveImport({ tournament }: { tournament?: TournamentView }) {
  const teamLimit = tournament?.rules.teamSize ?? 6
  const inputId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<ImportStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SaveImportView | null>(null)
  const [selection, setSelection] = useState<string[]>([])
  const [registration, setRegistration] = useState<RegisteredTeamView | TeamDraftView | null>(null)
  const [lockedTeam, setLockedTeam] = useState<LockedTeamView | null>(null)
  const [registrationPending, setRegistrationPending] = useState(false)
  const [registrationError, setRegistrationError] = useState<string | null>(null)

  useEffect(() => {
    if (!tournament) return
    const controller = new AbortController()
    void fetch(`/api/tournaments/${tournament.id}/team-draft`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return null
        const body = await response.json() as TeamDraftWorkspaceView | { error?: string }
        if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'The saved draft could not be loaded.')
        return body as TeamDraftWorkspaceView
      })
      .then((workspace) => {
        if (!workspace) return
        setResult(workspace.saveImport)
        setSelection(workspace.draft.pokemon.map((pokemon) => pokemon.fingerprint))
        setRegistration(workspace.draft)
        setStatus('success')
      })
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setError(caught instanceof Error ? caught.message : 'The saved draft could not be loaded.')
        setStatus('error')
      })
    return () => controller.abort()
  }, [tournament])

  useEffect(() => {
    if (!tournament) return
    const controller = new AbortController()
    void fetch(`/api/tournaments/${tournament.id}/team-lock`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return null
        const body = await response.json() as LockedTeamView | { error?: string }
        if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'The team lock could not be loaded.')
        return body as LockedTeamView
      })
      .then(setLockedTeam)
      .catch((caught) => {
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setRegistrationError(caught instanceof Error ? caught.message : 'The team lock could not be loaded.')
      })
    return () => controller.abort()
  }, [tournament])

  const counts = useMemo(() => {
    if (!result) return null
    return {
      party: result.pokemon.filter((pokemon) => pokemon.source.kind === 'party').length,
      boxes: result.pokemon.filter((pokemon) => pokemon.source.kind === 'box').length,
    }
  }, [result])
  const fileIsValid = file?.name.toLowerCase().endsWith('.sav') === true && file.size === fireRedSaveSize

  function chooseFile(selected: File | null) {
    if (lockedTeam) return
    setResult(null)
    setSelection([])
    setRegistration(null)
    setRegistrationError(null)
    setError(null)
    setFile(selected)
    if (!selected) {
      setStatus('idle')
      return
    }
    if (!selected.name.toLowerCase().endsWith('.sav')) {
      setStatus('error')
      setError('Choose the raw .sav file—not a ROM or an Analogue Pocket save state.')
      return
    }
    if (selected.size !== fireRedSaveSize) {
      setStatus('error')
      setError(`This file is ${(selected.size / 1024).toFixed(0)} KiB. FireRed saves must be exactly 128 KiB.`)
      return
    }
    setStatus('ready')
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || status === 'importing') return

    setStatus('importing')
    setError(null)
    const uploadId = createClientUuid()
    const uploadController = new AbortController()
    let timeoutId: number | undefined
    try {
      const bytes = await file.arrayBuffer()
      if (bytes.byteLength !== fireRedSaveSize) throw new Error('The selected save changed before it could be uploaded. Choose it again.')
      const uploadPromise = fetch('/api/save-imports/fire-red', {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
          'x-upload-id': uploadId,
          ...(tournament ? { 'x-tournament-id': tournament.id } : {}),
        },
        body: bytes,
        cache: 'no-store',
        signal: uploadController.signal,
      }).then(importResponse)
      const timeoutPromise = new Promise<SaveImportView>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error('The save import timed out. Check the Wi-Fi connection and try again.')), 15_000)
      })
      const imported = await Promise.race([
        uploadPromise,
        ...(tournament ? [recoverImport(tournament.id, uploadId)] : []),
        timeoutPromise,
      ])
      setResult(imported)
      setSelection(imported.pokemon
        .filter((pokemon) => !pokemon.egg && pokemon.entityValid && pokemon.legalityValid && pokemon.moves.length > 0)
        .slice(0, teamLimit)
        .map((pokemon) => pokemon.fingerprint))
      setStatus('success')
    } catch (caught) {
      setStatus('error')
      setError(caught instanceof Error ? caught.message : 'The save could not be imported.')
    } finally {
      uploadController.abort()
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    }
  }

  function togglePokemon(fingerprint: string) {
    if (registration || lockedTeam) return
    setRegistrationError(null)
    setSelection((current) => current.includes(fingerprint)
      ? current.filter((value) => value !== fingerprint)
      : current.length < teamLimit ? [...current, fingerprint] : current)
  }

  function moveSelection(index: number, direction: -1 | 1) {
    if (registration || lockedTeam) return
    setSelection((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      const selected = next[index]
      const displaced = next[target]
      if (!selected || !displaced) return current
      next[index] = displaced
      next[target] = selected
      return next
    })
  }

  async function saveTeam() {
    if (!result || !selection.length || registrationPending || registration) return
    setRegistrationPending(true)
    setRegistrationError(null)
    try {
      const response = await fetch(tournament ? `/api/tournaments/${tournament.id}/team-draft` : '/api/team-registrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploadId: result.uploadId, tournamentId: tournament?.id, pokemonFingerprints: selection }),
      })
      const body = await response.json() as RegisteredTeamView | TeamDraftView | { error?: string }
      if (!response.ok) {
        throw new Error('error' in body && body.error ? body.error : 'The team could not be registered.')
      }
      setRegistration(body as RegisteredTeamView | TeamDraftView)
    } catch (caught) {
      setRegistrationError(caught instanceof Error ? caught.message : 'The team could not be registered.')
    } finally {
      setRegistrationPending(false)
    }
  }

  async function finalizeTeam() {
    if (!tournament || lockedTeam || !registration || !('draftId' in registration)) return
    setRegistrationPending(true)
    setRegistrationError(null)
    try {
      const response = await fetch(`/api/tournaments/${tournament.id}/team-lock`, { method: 'POST' })
      const body = await response.json() as LockedTeamView | { error?: string }
      if (!response.ok) throw new Error('error' in body && body.error ? body.error : 'The team could not be locked.')
      setLockedTeam(body as LockedTeamView)
    } catch (caught) {
      setRegistrationError(caught instanceof Error ? caught.message : 'The team could not be locked.')
    } finally {
      setRegistrationPending(false)
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>{tournament ? `${tournament.name} · private team room` : 'Team intake · FireRed pilot'}</p>
          <h1>Open your save.<br />Meet your team.</h1>
          <p>
            Select the raw 128 KiB <code>.sav</code> file from your Analogue Pocket. PKHeX
            reads the party and PC boxes locally; your original file is never changed.
          </p>
        </div>

        <form className={styles.importPanel} onSubmit={submit}>
          <div className={styles.profileBadge}>
            <span>FR</span>
            <div><strong>Pokémon FireRed</strong><small>Generation III · English</small></div>
          </div>

          <label className={styles.filePicker} htmlFor={inputId}>
            <span>{file ? 'Change save file' : 'Choose save file'}</span>
            <small>{file?.name ?? 'Analogue Pocket .sav · exactly 128 KiB'}</small>
          </label>
          <input
            className={styles.hiddenInput}
            id={inputId}
            type="file"
            disabled={Boolean(lockedTeam)}
            accept=".sav,application/octet-stream"
            onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
          />

          {error && <p className={styles.error} role="alert">{error}</p>}

          <button disabled={!fileIsValid || status === 'importing'} type="submit">
            {status === 'importing' ? 'Reading save…' : 'Import Pokémon'}
          </button>

          <p className={styles.privacy}>
            <span aria-hidden="true">●</span>
            Parsed on this Mac · raw save not retained · source remains untouched
          </p>
        </form>
      </section>

      {result && counts && (
        <section className={styles.results} aria-live="polite">
          <div className={styles.resultHeader}>
            <div>
              <p className={styles.eyebrow}>Import complete</p>
              <h2>{result.pokemon.length} Pokémon found</h2>
              <p>{counts.party} in party · {counts.boxes} in PC boxes</p>
            </div>
            <dl className={styles.saveFacts}>
              <div><dt>Trainer</dt><dd>{result.trainer.name}</dd></div>
              <div><dt>Play time</dt><dd>{result.trainer.playTime}</dd></div>
              <div><dt>Language</dt><dd>{result.language}</dd></div>
              <div><dt>Checksums</dt><dd>{result.checksumsValid ? 'Healthy' : 'Review needed'}</dd></div>
            </dl>
          </div>

          {result.warnings.map((warning) => (
            <p className={styles.warning} key={warning}>{warning}</p>
          ))}

          <section className={styles.teamBuilder} aria-labelledby="team-builder-heading">
            <div className={styles.builderHeading}>
              <div>
                <p className={styles.eyebrow}>{tournament ? 'Private team draft' : 'Battle registration'}</p>
                <h3 id="team-builder-heading">Choose and order your team</h3>
                <p>Select up to {tournament?.rules.teamSize ?? 6} Pokémon. The first Pokémon is your opening lead.</p>
              </div>
              <strong>{selection.length}/{teamLimit} selected</strong>
            </div>

            {selection.length > 0 && (
              <ol className={styles.teamOrder}>
                {selection.map((fingerprint, index) => {
                  const pokemon = result.pokemon.find((candidate) => candidate.fingerprint === fingerprint)
                  if (!pokemon) return null
                  return (
                    <li key={fingerprint}>
                      <span>{index === 0 ? 'Lead' : index + 1}</span>
                      <strong>{pokemon.nickname || pokemon.species}</strong>
                      <small>Lv. {pokemon.level} {pokemon.species}</small>
                      <div>
                        <button aria-label={`Move ${pokemon.nickname || pokemon.species} earlier`} disabled={index === 0 || Boolean(registration)} onClick={() => moveSelection(index, -1)} type="button">↑</button>
                        <button aria-label={`Move ${pokemon.nickname || pokemon.species} later`} disabled={index === selection.length - 1 || Boolean(registration)} onClick={() => moveSelection(index, 1)} type="button">↓</button>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}

            <div className={styles.normalization}>
              <strong>Battle normalization</strong>
              <span>Starts fully healed</span>
              <span>Showdown maximum move PP</span>
              <span>Original save never changed</span>
            </div>

            {registrationError && <p className={styles.error} role="alert">{registrationError}</p>}
            {lockedTeam ? (
              <div className={styles.lockedTeam}>
                <div><span aria-hidden="true">✓</span><p><strong>Team locked for battle</strong><small>{lockedTeam.pokemonCount} Pokémon · registration {lockedTeam.registrationId.slice(0, 8)}</small></p></div>
              </div>
            ) : registration ? (
              <div className={styles.lockedTeam}>
                {'draftId' in registration ? <>
                  <div><span aria-hidden="true">✓</span><p><strong>Draft saved privately</strong><small>Draft {registration.draftId.slice(0, 8)} · editable until the team lock</small></p></div>
                  <div>
                    <button disabled={registrationPending} onClick={() => setRegistration(null)} type="button">Keep editing</button>
                    <button disabled={registrationPending || selection.length < 1} onClick={finalizeTeam} type="button">
                      {registrationPending ? 'Locking…' : 'Lock team'}
                    </button>
                  </div>
                </> : <>
                  <div><span aria-hidden="true">✓</span><p><strong>Team locked</strong><small>Registration {registration.registrationId.slice(0, 8)} · a new demo battle is ready</small></p></div>
                  <Link to="/skin-lab?player=p1">Battle with this team</Link>
                </>}
              </div>
            ) : (
              <button className={styles.lockButton} disabled={!selection.length || registrationPending} onClick={saveTeam} type="button">
                {registrationPending ? 'Validating with Showdown…' : tournament ? `Save ${selection.length || ''} Pokémon as private draft` : `Lock ${selection.length || ''} Pokémon and prepare battle`}
              </button>
            )}
          </section>

          <div className={styles.collection}>
            {result.pokemon.map((pokemon) => (
              <PokemonCard
                key={`${pokemon.source.kind}-${pokemon.source.box}-${pokemon.source.slot}-${pokemon.fingerprint}`}
                onToggle={() => togglePokemon(pokemon.fingerprint)}
                pokemon={pokemon}
                selected={selection.includes(pokemon.fingerprint)}
                selectionDisabled={Boolean(registration) || Boolean(lockedTeam) || pokemon.egg || !pokemon.entityValid || !pokemon.legalityValid || pokemon.moves.length === 0 || (!selection.includes(pokemon.fingerprint) && selection.length >= teamLimit)}
              />
            ))}
          </div>

          <p className={styles.importReceipt}>
            Imported from {result.sourceDevice} · {result.filename} · parser {result.parserVersion}
          </p>
        </section>
      )}
    </main>
  )
}
