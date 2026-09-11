import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { mapAndValidateImportedTeam } from './ShowdownTeamAdapter.js'
import { importedMankey } from './testFixtures.js'

const require = createRequire(import.meta.url)
const { BattleStream, getPlayerStreams, Teams } = require('pokemon-showdown') as typeof import('pokemon-showdown')

describe('PKHeX to Showdown team adapter', () => {
  it('preserves every battle-relevant trained value in the packed team', () => {
    const result = mapAndValidateImportedTeam([importedMankey])
    const [set] = Teams.unpack(result.packed) ?? []

    expect(result.sets[0]?.name).toBe('MANKEY')
    expect(set).toMatchObject({
      name: 'Mankey',
      species: 'Mankey',
      item: '',
      ability: 'Vital Spirit',
      moves: ['Scratch', 'Leer', 'Low Kick', 'Karate Chop'],
      nature: 'Mild',
      gender: 'M',
      level: 11,
      happiness: 114,
      evs: { hp: 1, atk: 19, def: 2, spa: 1, spd: 0, spe: 23 },
      ivs: { hp: 22, atk: 22, def: 26, spa: 30, spd: 9, spe: 12 },
    })
  })

  it('retains a nickname that is distinct from the species name', () => {
    const result = mapAndValidateImportedTeam([{ ...importedMankey, nickname: 'Punchy' }])
    const [set] = Teams.unpack(result.packed) ?? []

    expect(set?.name).toBe('Punchy')
    expect(set?.species).toBe('Mankey')
  })

  it('produces the same six battle stats Showdown uses for the imported Pokémon', async () => {
    const { packed } = mapAndValidateImportedTeam([importedMankey])
    const battleStream = new BattleStream({ keepAlive: true })
    const streams = getPlayerStreams(battleStream)
    const requests = [streams.p1, streams.p2].map(async (stream) => {
      for await (const chunk of stream) {
        if (chunk.includes('|request|')) return
      }
    })

    try {
      await streams.omniscient.write([
        `>start ${JSON.stringify({ formatid: 'gen3customgame', seed: [1, 2, 3, 4] })}`,
        `>player p1 ${JSON.stringify({ name: 'MAY', team: packed })}`,
        `>player p2 ${JSON.stringify({ name: 'BLUE', team: packed })}`,
      ].join('\n'))
      await Promise.all(requests)

      const pokemon = battleStream.battle?.sides[0]?.pokemon[0]
      expect({ hp: pokemon?.maxhp, ...pokemon?.storedStats }).toEqual({
        hp: 32,
        atk: 25,
        def: 13,
        spa: 17,
        spd: 15,
        spe: 22,
      })
    } finally {
      battleStream.destroy()
    }
  })
})
