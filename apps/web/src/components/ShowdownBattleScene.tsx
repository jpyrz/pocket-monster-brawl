import { useCallback, useEffect, useRef } from 'react'
import type { DemoPlayerId } from '@pmb/domain'
import styles from './SkinLab.module.scss'

type ShowdownBattleSceneProps = {
  player: DemoPlayerId
  protocol: readonly string[]
}

export function ShowdownBattleScene({ player, protocol }: ShowdownBattleSceneProps) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  const sendProtocol = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage({
      type: 'pmb-showdown-protocol',
      player,
      lines: protocol,
    }, '*')
  }, [player, protocol])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source === frameRef.current?.contentWindow && event.data?.type === 'pmb-showdown-ready') {
        sendProtocol()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [sendProtocol])

  useEffect(() => sendProtocol(), [sendProtocol])

  return (
    <iframe
      className={styles.showdownScene}
      onLoad={sendProtocol}
      ref={frameRef}
      sandbox="allow-scripts"
      src="/showdown-scene.html"
      title="Animated Pokémon battle"
    />
  )
}
