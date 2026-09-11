(function () {
  'use strict'

  const stage = document.getElementById('scene-stage')
  const error = document.getElementById('scene-error')
  let battle = null
  let receivedLines = []
  let perspective = 'p1'

  function resize() {
    const scale = Math.min(window.innerWidth / 640, window.innerHeight / 360)
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`
  }

  function showError(message) {
    error.textContent = message
    error.classList.add('visible')
  }

  function createBattle(lines, player) {
    if (typeof window.Battle !== 'function' || typeof window.jQuery !== 'function') {
      showError('The Showdown battle renderer could not be loaded.')
      return
    }

    error.classList.remove('visible')
    window.jQuery('.battle').empty()
    window.jQuery('.battle-log').empty()
    battle = new window.Battle({
      $frame: window.jQuery('.battle'),
      $logFrame: window.jQuery('.battle-log'),
      log: [],
      paused: false,
      isReplay: false,
      autoresize: false,
    })
    battle.messageFadeTime = 180
    battle.messageShownTime = 500
    if (player === 'p2') battle.switchViewpoint()
    for (const line of lines) battle.add(line)
    receivedLines = lines.slice()
    perspective = player
  }

  function updateBattle(lines, player) {
    const stillSameBattle = battle && player === perspective &&
      receivedLines.every((line, index) => lines[index] === line)
    if (!stillSameBattle || lines.length < receivedLines.length) {
      createBattle(lines, player)
      return
    }
    for (const line of lines.slice(receivedLines.length)) battle.add(line)
    receivedLines = lines.slice()
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data || event.data.type !== 'pmb-showdown-protocol') return
    if (!Array.isArray(event.data.lines) || !['p1', 'p2'].includes(event.data.player)) return
    updateBattle(event.data.lines.filter((line) => typeof line === 'string'), event.data.player)
  })
  window.addEventListener('resize', resize)
  resize()
  window.parent.postMessage({ type: 'pmb-showdown-ready' }, '*')
})()
