import { describe, expect, it } from 'vitest'
import {
  fixtureSkin,
  adaptDeltaSkinInfo,
  profiles,
  resolveProfile,
  UnsupportedProfileCombinationError,
  validateSkinAssetPath,
  validateSkinManifest,
  type GenerationTwoPokemon,
} from './index.js'

describe('versioned game profiles', () => {
  it('keeps independent rule and UI capabilities per generation', () => {
    expect(profiles).toHaveLength(2)
    expect(resolveProfile('firered-gen3-v1', 'pokemon-firered')).toMatchObject({
      battleGeneration: 3,
      showdownFormat: 'gen3customgame',
      ui: { abilities: true, natures: true },
    })
    expect(resolveProfile('synthetic-gen2-v1', 'synthetic-crystal')).toMatchObject({
      battleGeneration: 2,
      showdownFormat: 'gen2customgame',
      ui: { abilities: false, natures: false },
    })
  })

  it('rejects an unvalidated source-game and rules combination', () => {
    expect(() => resolveProfile('firered-gen3-v1', 'synthetic-crystal')).toThrow(
      UnsupportedProfileCombinationError,
    )
  })

  it('retains generation-specific trained values', () => {
    const fixture: GenerationTwoPokemon = {
      generation: 2,
      species: 'Pikachu',
      form: null,
      level: 42,
      nickname: 'SPARK',
      gender: 'F',
      shiny: false,
      moves: ['Thunderbolt'],
      heldItem: 'Light Ball',
      friendship: 211,
      dvs: { attack: 12, defense: 9, speed: 15, special: 13 },
      statExperience: { hp: 1024, attack: 2048, defense: 0, speed: 4096, special: 512 },
      provenance: {
        uploadId: 'fixture-upload',
        sourceGame: 'synthetic-crystal',
        sourceSlot: 'party:0',
        rawPokemonHash: 'fixture-only',
        importerVersion: 'synthetic-v1',
      },
    }

    expect(fixture.statExperience.defense).toBe(0)
    expect(fixture.dvs.special).toBe(13)
  })
})

describe('skin compatibility boundary', () => {
  it('accepts the labeled fixture geometry', () => {
    expect(validateSkinManifest(fixtureSkin)).toBe(fixtureSkin)
  })

  it.each(['../secret.png', '/absolute.png', 'https://example.com/skin.png', 'nested\\..\\secret.png'])(
    'rejects unsafe asset path %s',
    (path) => expect(() => validateSkinAssetPath(path)).toThrow('Unsafe skin asset path'),
  )

  it('adapts current Delta screen metadata and reports unmapped emulator actions', () => {
    const result = adaptDeltaSkinInfo({
      name: 'Test skin',
      identifier: 'com.example.test-gba',
      gameTypeIdentifier: 'com.rileytestut.delta.game.gba',
      representations: { iphone: { edgeToEdge: { portrait: {
        assets: { resizable: 'portrait.pdf' },
        mappingSize: { width: 414, height: 896 },
        screens: [{ outputFrame: { x: 27, y: 55, width: 360, height: 240 } }],
        items: [
          { inputs: { up: 'up', down: 'down', left: 'left', right: 'right' }, frame: { x: 30, y: 520, width: 150, height: 150 } },
          { inputs: ['a'], frame: { x: 330, y: 530, width: 50, height: 50 } },
          { inputs: ['b'], frame: { x: 260, y: 590, width: 50, height: 50 } },
          { inputs: ['quickSave'], frame: { x: 180, y: 740, width: 50, height: 30 } },
        ],
      } } } },
    }, 'Fixture creator')

    expect(result.manifest.screen).toEqual({ x: 27, y: 55, width: 360, height: 240 })
    expect(result.manifest.controls.map((control) => control.action)).toEqual([
      'up', 'down', 'left', 'right', 'confirm', 'back',
    ])
    expect(result.assetPaths).toEqual(['portrait.pdf'])
    expect(result.disabledInputs).toEqual(['quickSave'])
  })
})
