type GameIconName = 'league' | 'mail' | 'player' | 'plus' | 'gear' | 'back' | 'lock' | 'play'

const paths: Record<GameIconName, React.ReactNode> = {
  league: <><path d="M4 6.5h16v12H4z" /><path d="M7 3.5h10v3M8 10h8M8 14h5" /></>,
  mail: <><path d="M3.5 5.5h17v13h-17z" /><path d="m4.5 7 8 6 8-6" /></>,
  player: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21c.7-5 3.2-7.5 7.5-7.5S18.8 16 19.5 21" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" /></>,
  back: <><path d="m14.5 5-7 7 7 7" /><path d="M8 12h12" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  play: <path d="m8 5 11 7-11 7z" />,
}

export function GameIcon({ name }: { name: GameIconName }) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}
