(() => {
  'use strict'

  const TARGET_SELECTOR = '#web_bg'
  let trunkEffect = null
  let trunkElement = null

  const destroyTrunk = () => {
    if (trunkEffect && typeof trunkEffect.destroy === 'function') {
      trunkEffect.destroy()
    }
    trunkEffect = null
    trunkElement = null
  }

  const initTrunk = () => {
    const target = document.querySelector(TARGET_SELECTOR)

    if (!target || !window.VANTA || typeof window.VANTA.TRUNK !== 'function') {
      return
    }

    if (trunkEffect && trunkElement === target) {
      return
    }

    destroyTrunk()
    trunkElement = target
    trunkEffect = window.VANTA.TRUNK({
      el: target,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200.0,
      minWidth: 200.0,
      scale: 1.0,
      scaleMobile: 1.0,
      color: 0xe6c2cb,
      backgroundColor: 0xeef0f7,
      spacing: 10.0
    })
  }

  const scheduleInit = () => window.requestAnimationFrame(initTrunk)

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleInit, { once: true })
  } else {
    scheduleInit()
  }

  document.addEventListener('pjax:complete', scheduleInit)
  window.addEventListener('pageshow', scheduleInit)
  window.addEventListener('pagehide', destroyTrunk)
})()
