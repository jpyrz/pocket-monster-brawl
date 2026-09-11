import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { TeamValidator, Teams } = require('pokemon-showdown') as typeof import('pokemon-showdown')

type ShowdownTeam = NonNullable<Parameters<typeof Teams.pack>[0]>

const ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 }
const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }

export const demoTeams = {
  p1: [
    { name: 'Sparky', species: 'Pikachu', item: 'Light Ball', ability: 'Static', moves: ['Thunderbolt', 'Quick Attack', 'Iron Tail', 'Brick Break'], nature: 'Hasty', gender: 'F', evs, ivs, level: 50, happiness: 211 },
    { name: 'Shellshock', species: 'Blastoise', item: 'Leftovers', ability: 'Torrent', moves: ['Surf', 'Ice Beam', 'Protect', 'Bite'], nature: 'Modest', gender: 'M', evs, ivs, level: 50, happiness: 180 },
    { name: 'Blaze', species: 'Arcanine', item: 'Charcoal', ability: 'Intimidate', moves: ['Flamethrower', 'Extreme Speed', 'Crunch', 'Iron Tail'], nature: 'Lonely', gender: 'M', evs, ivs, level: 50, happiness: 200 },
    { name: 'Canopy', species: 'Venusaur', item: 'Miracle Seed', ability: 'Overgrow', moves: ['Giga Drain', 'Sludge Bomb', 'Sleep Powder', 'Synthesis'], nature: 'Calm', gender: 'F', evs, ivs, level: 50, happiness: 160 },
    { name: 'Spoon', species: 'Alakazam', item: 'Twisted Spoon', ability: 'Synchronize', moves: ['Psychic', 'Calm Mind', 'Fire Punch', 'Recover'], nature: 'Timid', gender: 'M', evs, ivs, level: 50, happiness: 220 },
    { name: 'Dozer', species: 'Snorlax', item: 'Chesto Berry', ability: 'Immunity', moves: ['Body Slam', 'Shadow Ball', 'Rest', 'Brick Break'], nature: 'Careful', gender: 'M', evs, ivs, level: 50, happiness: 255 },
  ],
  p2: [
    { name: 'Wildfire', species: 'Charizard', item: 'Charcoal', ability: 'Blaze', moves: ['Flamethrower', 'Wing Attack', 'Slash', 'Brick Break'], nature: 'Mild', gender: 'M', evs, ivs, level: 50, happiness: 190 },
    { name: 'Voltage', species: 'Raichu', item: 'Magnet', ability: 'Static', moves: ['Thunderbolt', 'Brick Break', 'Double Team', 'Quick Attack'], nature: 'Naive', gender: 'M', evs, ivs, level: 50, happiness: 205 },
    { name: 'Nessie', species: 'Lapras', item: 'Never-Melt Ice', ability: 'Water Absorb', moves: ['Surf', 'Ice Beam', 'Body Slam', 'Confuse Ray'], nature: 'Quiet', gender: 'F', evs, ivs, level: 50, happiness: 170 },
    { name: 'Shade', species: 'Gengar', item: 'Spell Tag', ability: 'Levitate', moves: ['Shadow Ball', 'Sludge Bomb', 'Hypnosis', 'Dream Eater'], nature: 'Timid', gender: 'M', evs, ivs, level: 50, happiness: 150 },
    { name: 'Atlas', species: 'Machamp', item: 'Black Belt', ability: 'Guts', moves: ['Cross Chop', 'Rock Slide', 'Earthquake', 'Bulk Up'], nature: 'Adamant', gender: 'M', evs, ivs, level: 50, happiness: 230 },
    { name: 'Comet', species: 'Dragonite', item: 'Dragon Fang', ability: 'Inner Focus', moves: ['Dragon Claw', 'Aerial Ace', 'Thunder Wave', 'Ice Beam'], nature: 'Rash', gender: 'F', evs, ivs, level: 50, happiness: 240 },
  ],
} as const satisfies Record<'p1' | 'p2', ShowdownTeam>

export function validateAndPackDemoTeams(): { p1: string; p2: string } {
  const validator = new TeamValidator('gen3customgame')
  for (const [player, team] of Object.entries(demoTeams)) {
    const problems = validator.validateTeam([...team])
    if (problems?.length) {
      throw new Error(`Invalid ${player} demo team: ${problems.join(' ')}`)
    }
  }

  return {
    p1: Teams.pack([...demoTeams.p1]),
    p2: Teams.pack([...demoTeams.p2]),
  }
}
