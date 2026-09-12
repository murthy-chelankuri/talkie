/**
 * What the viewer sees happen.
 *
 * A screen recording shows the result of a click but not the click: a value changes somewhere on
 * screen and the viewer has to work backwards to what was pressed. Drawing the target as it is
 * used is the difference between a recording someone can follow and one they have to be talked
 * through.
 *
 * This runs inside the recorded page, so it is written as a string and kept away from anything
 * the page can object to:
 *
 * - No stylesheet. A page with a strict `style-src` would refuse one, and the recording would
 *   silently lose its highlights. Styles are set as properties and animated with the Web
 *   Animations API, neither of which a content policy governs.
 * - Nothing is ever an event target: the layer is `pointer-events: none`, so the page behaves
 *   exactly as it would unrecorded, and the action log never sees a highlight instead of a
 *   button.
 * - It draws only, and never reads or sends anything.
 */
export interface HighlightOptions {
  /** The colour of the ring, so a recording can match the project it belongs to. */
  accent?: string
}

const DEFAULT_ACCENT = '#d3a24c'

export function highlightScript({ accent = DEFAULT_ACCENT }: HighlightOptions = {}): string {
  return `
(() => {
  if (window.__talkieHighlight) return
  window.__talkieHighlight = true

  const ACCENT = ${JSON.stringify(accent)}
  const GLOW = ACCENT + '55'

  // A ring around most of the screen is not a highlight, it is a border. Past this, only the
  // ripple is drawn.
  const MAX_SHARE_OF_VIEWPORT = 0.75

  let layer = null

  function host() {
    return document.body || document.documentElement
  }

  function ensureLayer() {
    if (layer && layer.isConnected) return layer

    layer = document.createElement('div')
    layer.setAttribute('data-talkie-highlight', '')
    Object.assign(layer.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      right: '0px',
      bottom: '0px',
      pointerEvents: 'none',
      zIndex: '2147483647',
      overflow: 'hidden',
      contain: 'strict'
    })
    host().appendChild(layer)
    return layer
  }

  /**
   * What was really pressed.
   *
   * A click lands on whatever is under the pointer — often a span inside the button, sometimes
   * the page itself. Walking up to the thing that behaves like a control rings the button rather
   * than the word printed on it.
   */
  function controlFor(node) {
    let el = node instanceof Element ? node : null

    for (let depth = 0; el && depth < 5; depth += 1, el = el.parentElement) {
      if (el.matches('a, button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [contenteditable="true"]')) {
        return el
      }
    }
    return null
  }

  function boxFor(el) {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return null
    if (
      rect.width > window.innerWidth * MAX_SHARE_OF_VIEWPORT &&
      rect.height > window.innerHeight * MAX_SHARE_OF_VIEWPORT
    ) {
      return null
    }
    return rect
  }

  function makeRing(el, rect, role) {
    const ring = document.createElement('div')
    const radius = getComputedStyle(el).borderRadius
    // Named so the three kinds can be told apart from outside — by a test, or by anyone looking
    // at why a recording drew what it drew.
    ring.setAttribute('data-talkie-role', role)

    Object.assign(ring.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      border: '2px solid ' + ACCENT,
      borderRadius: radius && radius !== '0px' ? radius : '6px',
      boxShadow: '0 0 0 4px ' + GLOW,
      pointerEvents: 'none'
    })
    place(ring, rect)
    return ring
  }

  // Sat 3px outside the element, so the ring frames it instead of covering its own border.
  function place(ring, rect) {
    ring.style.left = rect.left - 3 + 'px'
    ring.style.top = rect.top - 3 + 'px'
    ring.style.width = rect.width + 6 + 'px'
    ring.style.height = rect.height + 6 + 'px'
  }

  function flashClick(el) {
    const rect = boxFor(el)
    if (!rect) return

    const ring = makeRing(el, rect, 'click')
    ensureLayer().appendChild(ring)

    // Settling inwards reads as the control being pressed, rather than as something appearing
    // next to it.
    const animation = ring.animate(
      [
        { opacity: 0, transform: 'scale(1.09)' },
        { opacity: 1, transform: 'scale(1)', offset: 0.25 },
        { opacity: 1, transform: 'scale(1)', offset: 0.62 },
        { opacity: 0, transform: 'scale(1.02)' }
      ],
      { duration: 820, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
    )
    animation.onfinish = () => ring.remove()
    animation.oncancel = () => ring.remove()
  }

  function ripple(x, y) {
    const dot = document.createElement('div')
    dot.setAttribute('data-talkie-role', 'ripple')
    Object.assign(dot.style, {
      position: 'absolute',
      left: x + 'px',
      top: y + 'px',
      width: '0px',
      height: '0px',
      marginLeft: '0px',
      marginTop: '0px',
      borderRadius: '50%',
      border: '2px solid ' + ACCENT,
      pointerEvents: 'none'
    })
    ensureLayer().appendChild(dot)

    const size = 92
    const animation = dot.animate(
      [
        { width: '0px', height: '0px', marginLeft: '0px', marginTop: '0px', opacity: 0.9 },
        {
          width: size + 'px',
          height: size + 'px',
          marginLeft: -size / 2 + 'px',
          marginTop: -size / 2 + 'px',
          opacity: 0
        }
      ],
      { duration: 620, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    )
    animation.onfinish = () => dot.remove()
    animation.oncancel = () => dot.remove()
  }

  // --- typing -------------------------------------------------------------
  // A field being typed into is highlighted for as long as it is being typed into, rather than
  // flashed once: the point is to show where the words are going while they appear.

  let focusRing = null
  let focused = null
  let following = 0

  function follow() {
    if (!focused || !focusRing) return
    if (!focused.isConnected) return releaseFocus()

    const rect = focused.getBoundingClientRect()
    if (rect.width && rect.height) place(focusRing, rect)
    following = requestAnimationFrame(follow)
  }

  function holdFocus(el) {
    releaseFocus()

    const rect = boxFor(el)
    if (!rect) return

    focused = el
    focusRing = makeRing(el, rect, 'focus')
    focusRing.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
    ensureLayer().appendChild(focusRing)
    // Followed frame by frame rather than on scroll alone, so it stays put through a page that
    // animates, reflows or moves the field under it.
    following = requestAnimationFrame(follow)
  }

  function releaseFocus() {
    if (following) cancelAnimationFrame(following)
    following = 0

    const ring = focusRing
    focused = null
    focusRing = null
    if (!ring) return

    const fade = ring.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in' })
    fade.onfinish = () => ring.remove()
    fade.oncancel = () => ring.remove()
  }

  function isTextEntry(el) {
    if (!(el instanceof Element)) return false
    if (el.matches('textarea, select, [contenteditable="true"]')) return true
    if (!el.matches('input')) return false

    // Buttons and checkboxes are inputs too, and they are a click rather than an entry.
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(el.type)
  }

  document.addEventListener(
    'pointerdown',
    (event) => {
      try {
        ripple(event.clientX, event.clientY)
        const control = controlFor(event.target)
        if (control && !isTextEntry(control)) flashClick(control)
      } catch {}
    },
    true
  )

  document.addEventListener(
    'focusin',
    (event) => {
      try {
        if (isTextEntry(event.target)) holdFocus(event.target)
      } catch {}
    },
    true
  )

  document.addEventListener('focusout', () => releaseFocus(), true)
})()
`
}
