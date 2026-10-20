/**
 * Talkie's runtime, injected first into every scene page by the asset server.
 *
 * It owns the page's time: the clock only moves when the host asks for a frame, every animation is
 * held at that moment, and the page answers "drawn" once the picture is ready to capture. It also
 * hands the page its theme, values and narration timings. See the spec, section 3.
 */
import { createClock } from './clock'
import { animationsBefore, animationsHeld, noteNewAnimations, registerAnime, registerLottie, settleAnimations } from './animations'
import { applyTheme } from './theme'
import type { HostMessage, SceneMessage, SceneTheme } from '../protocol'

// WebRTC reaches the network without asking the page's policy — a STUN request is a message out.
// Removed before the page's own code runs; with no frames or other windows allowed, it has no
// other realm to fetch a fresh one from.
for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
  try {
    delete (window as unknown as Record<string, unknown>)[name]
  } catch {
    // Not configurable here; the policy still holds everything else.
  }
}

/** Where this script was served from — the asset server's `__talkie/` — for Talkie's own fonts. */
const talkieBase = ((document.currentScript as HTMLScriptElement | null)?.src ?? '').replace(/\/runtime\.js(?:\?.*)?$/, '')

const realRaf = window.requestAnimationFrame.bind(window)
const clock = createClock()
clock.install(window)

const handlers: Array<(t: number) => unknown> = []
const themeHandlers: Array<(theme: SceneTheme | null) => unknown> = []
const waits: Promise<unknown>[] = []
let resolveInit: () => void
const initialised = new Promise<void>((resolve) => { resolveInit = resolve })

const send = (message: SceneMessage): void => window.parent.postMessage(message, '*')

const talkie = {
  time: 0, frame: 0, duration: 0, fps: 30,
  params: {} as Record<string, unknown>,
  theme: null as SceneTheme | null,
  beats: [] as number[],
  onFrame(fn: (t: number) => unknown): void { handlers.push(fn) },
  /** Called when the project's theme changes while the scene is showing — for words it reads from it. */
  onTheme(fn: (theme: SceneTheme | null) => unknown): void { themeHandlers.push(fn) },
  ready(promise: Promise<unknown>): void { waits.push(promise) },
  /**
   * Resolves once the theme, values and timings have arrived. A page's script runs before they do,
   * so anything built from them waits on this: talkie.ready(talkie.initialised.then(build)).
   */
  initialised,
  anime: registerAnime,
  lottie: registerLottie
}
Object.defineProperty(window, 'talkie', { value: talkie })

window.addEventListener('error', (event) => send({ type: 'talkie:error', message: event.message, line: event.lineno }))
window.addEventListener('unhandledrejection', (event) => send({ type: 'talkie:error', message: String((event.reason as Error)?.message ?? event.reason) }))
document.addEventListener('securitypolicyviolation', (event) =>
  send({ type: 'talkie:error', message: `Blocked: ${event.violatedDirective} ${event.blockedURI || ''}`.trim() })
)

/** One real paint, so the picture captured is the one just drawn. */
const painted = (): Promise<void> => new Promise((resolve) => realRaf(() => realRaf(() => resolve())))

async function seek(frame: number): Promise<void> {
  await initialised
  await Promise.allSettled(waits)
  const ms = (frame * 1000) / talkie.fps
  Object.assign(talkie, { frame, time: ms / 1000 })
  const before = animationsBefore(document)
  clock.advanceTo(ms)
  for (const handler of handlers) await handler(talkie.time)
  noteNewAnimations(document, before, ms)
  await document.fonts.ready
  await Promise.all(Array.from(document.images).filter((img) => !img.complete).map((img) => img.decode().catch(() => undefined)))
  // Held, painted, and checked: an animation the browser replaced in the meantime is held again
  // and the frame painted again, so the picture captured is the one this moment asks for.
  for (let attempt = 0; attempt < 5; attempt++) {
    await settleAnimations(document, ms)
    await painted()
    if (animationsHeld(document, ms)) break
  }
}

let queue = Promise.resolve()
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const message = event.data as HostMessage
  if (message?.type === 'talkie:init') {
    Object.assign(talkie, { fps: message.fps, duration: message.durationFrames / message.fps, params: message.params, theme: message.theme, beats: message.beats })
    void applyTheme(document, message.theme, talkieBase).then(() => resolveInit())
  } else if (message?.type === 'talkie:theme') {
    talkie.theme = message.theme
    void applyTheme(document, message.theme, talkieBase).then(() => {
      for (const handler of themeHandlers) handler(talkie.theme)
    })
  } else if (message?.type === 'talkie:seek') {
    // In order: a seek waits for the one before it, so replies come back in the order asked.
    queue = queue.then(() => seek(message.frame)).then(
      () => send({ type: 'talkie:drawn', id: message.id }),
      (err) => { send({ type: 'talkie:error', message: String((err as Error)?.message ?? err) }); send({ type: 'talkie:drawn', id: message.id }) }
    )
  }
})

window.addEventListener('load', () => send({ type: 'talkie:ready' }))
