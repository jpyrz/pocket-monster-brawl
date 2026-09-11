import { randomUUID } from 'node:crypto'
import type { RegisteredTeamView, SaveImportView, TeamDraftView, TeamDraftWorkspaceView, TeamRegistrationRequest } from '@pmb/domain'
import { mapAndValidateImportedTeam, TeamAdapterError } from './ShowdownTeamAdapter.js'

export class TeamRegistrationError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'TeamRegistrationError'
  }
}

export type LockedRegistration = {
  view: RegisteredTeamView
  packedTeam: string
}

type OwnedImport = {
  saveImport: SaveImportView
  ownerId: string | null
  tournamentId: string | null
}

export class LocalTeamRegistry {
  private imports = new Map<string, OwnedImport>()
  private registration: LockedRegistration | null = null
  private drafts = new Map<string, TeamDraftView>()

  rememberImport(saveImport: SaveImportView, ownerId: string | null = null, tournamentId: string | null = null): void {
    this.imports.set(saveImport.uploadId, { saveImport: structuredClone(saveImport), ownerId, tournamentId })
  }

  register(
    request: TeamRegistrationRequest,
    ownerId: string | null = null,
    tournamentId: string | null = null,
    setAsDemoRegistration = true,
  ): LockedRegistration {
    if (!request || typeof request !== 'object' || typeof request.uploadId !== 'string') {
      throw new TeamRegistrationError('A valid save import is required.', 400)
    }
    if (!Array.isArray(request.pokemonFingerprints)) {
      throw new TeamRegistrationError('Choose between one and six Pokémon.', 400)
    }
    if (request.pokemonFingerprints.length < 1 || request.pokemonFingerprints.length > 6) {
      throw new TeamRegistrationError('Choose between one and six Pokémon.', 400)
    }
    if (request.pokemonFingerprints.some((fingerprint) => typeof fingerprint !== 'string')) {
      throw new TeamRegistrationError('Every selected Pokémon needs a valid fingerprint.', 400)
    }
    if (new Set(request.pokemonFingerprints).size !== request.pokemonFingerprints.length) {
      throw new TeamRegistrationError('A Pokémon cannot appear in the registered team twice.', 400)
    }

    const ownedImport = this.imports.get(request.uploadId)
    if (!ownedImport) {
      throw new TeamRegistrationError('That save import is no longer available. Import the save again.', 404)
    }
    if (ownedImport.ownerId !== ownerId || ownedImport.tournamentId !== tournamentId) {
      throw new TeamRegistrationError('That save import does not belong to this player and tournament.', 403)
    }
    const saveImport = ownedImport.saveImport

    const byFingerprint = new Map(saveImport.pokemon.map((pokemon) => [pokemon.fingerprint, pokemon]))
    const selected = request.pokemonFingerprints.map((fingerprint) => {
      const pokemon = byFingerprint.get(fingerprint)
      if (!pokemon) throw new TeamRegistrationError('A selected Pokémon was not found in that save import.', 400)
      if (pokemon.egg) throw new TeamRegistrationError(`${pokemon.nickname || pokemon.species} is still an Egg.`, 422)
      if (!pokemon.entityValid || !pokemon.legalityValid) {
        throw new TeamRegistrationError(`${pokemon.nickname || pokemon.species} did not pass import validation.`, 422)
      }
      if (!pokemon.moves.length) {
        throw new TeamRegistrationError(`${pokemon.nickname || pokemon.species} has no usable moves.`, 422)
      }
      return pokemon
    })

    let packedTeam: string
    try {
      packedTeam = mapAndValidateImportedTeam(selected).packed
    } catch (error) {
      if (error instanceof TeamAdapterError) throw new TeamRegistrationError(error.message, 422)
      throw error
    }

    const view: RegisteredTeamView = {
      registrationId: randomUUID(),
      uploadId: saveImport.uploadId,
      tournamentId,
      profileId: saveImport.profileId,
      player: 'p1',
      trainerName: saveImport.trainer.name,
      lockedAt: new Date().toISOString(),
      status: 'locked',
      pokemon: structuredClone(selected),
      normalization: {
        startsFullyHealed: true,
        movePp: 'showdown-default-maximum',
        sourceSaveModified: false,
      },
    }
    const registration = { view, packedTeam }
    if (setAsDemoRegistration) this.registration = registration
    return structuredClone(registration)
  }

  current(): LockedRegistration | null {
    return this.registration ? structuredClone(this.registration) : null
  }

  saveDraft(request: TeamRegistrationRequest, ownerId: string, tournamentId: string): TeamDraftView {
    const registration = this.register(request, ownerId, tournamentId, false)
    const key = this.draftKey(ownerId, tournamentId)
    const previous = this.drafts.get(key)
    const draft: TeamDraftView = {
      draftId: previous?.draftId ?? randomUUID(),
      uploadId: registration.view.uploadId,
      tournamentId,
      profileId: registration.view.profileId,
      trainerName: registration.view.trainerName,
      savedAt: new Date().toISOString(),
      status: 'draft',
      pokemon: registration.view.pokemon,
      normalization: registration.view.normalization,
    }
    this.drafts.set(key, structuredClone(draft))
    return structuredClone(draft)
  }

  currentDraft(ownerId: string, tournamentId: string): TeamDraftWorkspaceView | null {
    const draft = this.drafts.get(this.draftKey(ownerId, tournamentId))
    if (!draft) return null
    const ownedImport = this.imports.get(draft.uploadId)
    if (!ownedImport || ownedImport.ownerId !== ownerId || ownedImport.tournamentId !== tournamentId) return null
    return { draft: structuredClone(draft), saveImport: structuredClone(ownedImport.saveImport) }
  }

  private draftKey(ownerId: string, tournamentId: string) {
    return `${ownerId}:${tournamentId}`
  }
}
