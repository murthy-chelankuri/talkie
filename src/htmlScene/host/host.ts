import { DRAW_TIMEOUT_MS, isSceneMessage, type InitMessage } from '../protocol'

/**
 * A page that holds one scene the way the video does, for the headless check: same sandbox, same
 * messages. Driven from Playwright through window.talkieHost.
 */
let frame: HTMLIFrameElement | null = null
let nextId = 1
const errors: string[] = []
const waiting = new Map<number, () => void>()
let ready: () => void = () => undefined

window.addEventListener('message', (event) => {
  if (!frame || event.source !== frame.contentWindow || !isSceneMessage(event.data)) return
  const message = event.data
  if (message.type === 'talkie:ready') ready()
  else if (message.type === 'talkie:error') errors.push(message.line ? `${message.message} (line ${message.line})` : message.message)
  else if (message.type === 'talkie:drawn') { waiting.get(message.id)?.(); waiting.delete(message.id) }
})

Object.defineProperty(window, 'talkieHost', {
  value: {
    errors,
    load(url: string, init: Omit<InitMessage, 'type'>): Promise<void> {
      frame?.remove()
      frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.width = String(init.width)
      frame.height = String(init.height)
      const loaded = new Promise<void>((resolve, reject) => {
        ready = resolve
        setTimeout(() => reject(new Error('The scene did not finish loading.')), 15_000)
      })
      frame.src = url
      document.body.append(frame)
      return loaded.then(() => frame!.contentWindow!.postMessage({ type: 'talkie:init', ...init }, '*'))
    },
    seek(frameNumber: number): Promise<void> {
      const id = nextId++
      return new Promise<void>((resolve) => {
        const timer = setTimeout(() => { errors.push(`Frame ${frameNumber} was not drawn within 5 s.`); resolve() }, DRAW_TIMEOUT_MS)
        waiting.set(id, () => {
          clearTimeout(timer)
          resolve()
        })
        frame!.contentWindow!.postMessage({ type: 'talkie:seek', frame: frameNumber, id }, '*')
      })
    }
  }
})
