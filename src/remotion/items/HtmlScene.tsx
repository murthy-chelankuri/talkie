import { useEffect, useRef, useState } from 'react'
import { AbsoluteFill, continueRender, delayRender, getRemotionEnvironment, useCurrentFrame, useVideoConfig } from 'remotion'
import { useRenderTheme } from '../renderTheme'
import { DEFAULT_SCENE_THEMES, DRAW_TIMEOUT_MS, isSceneMessage, type SceneTheme } from '../../htmlScene/protocol'

interface HtmlSceneProps {
  src: string
  title: string
  style?: { theme?: 'brand' | 'light' | 'dark' }
  params?: Record<string, unknown>
  beats?: { at: number }[]
}

/** How long a page has to say it has loaded before the scene is drawn as a plain card instead. */
const LOAD_TIMEOUT_MS = 15_000

/**
 * A sandboxed frame may still navigate itself, and only the page framing it can refuse that. The
 * editor's policy already does; the export renders this composition in a page of Remotion's,
 * which has none — so the same rule is added here, once, before any scene is framed.
 */
function confineFrames(): void {
  if (typeof document === 'undefined' || document.querySelector('meta[data-talkie-frames]')) return
  const meta = document.createElement('meta')
  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = 'frame-src http://127.0.0.1:*'
  meta.setAttribute('data-talkie-frames', '')
  document.head.prepend(meta)
}

/**
 * A scene drawn by a web page, in a frame that may run scripts and do nothing else — no access to
 * this window, its storage, or the network (see htmlScene/policy.ts). Each video frame is asked
 * for by number and, while exporting, held until the page says it has drawn it.
 */
export function HtmlScene({ data }: { data: unknown }): JSX.Element {
  const scene = data as HtmlSceneProps
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const theme = useRenderTheme()
  const variant = scene.style?.theme ?? 'dark'
  // No theme means Talkie's own look, as it does for slides — never no look at all.
  const sceneTheme: SceneTheme = theme
    ? { ...theme.variants[variant], fonts: theme.fonts, ...(theme.logo ? { logo: theme.logo.url } : {}) }
    : DEFAULT_SCENE_THEMES[variant]
  const rendering = getRemotionEnvironment().isRendering

  const ref = useRef<HTMLIFrameElement>(null)
  const pending = useRef(new Map<number, () => void>())
  const nextId = useRef(1)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loadHandle] = useState(() => (rendering ? delayRender(`Loading the HTML scene "${scene.title}"`) : null))

  confineFrames()

  useEffect(() => {
    let loaded = false
    const settle = (): void => {
      if (loadHandle !== null) continueRender(loadHandle)
    }
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== ref.current?.contentWindow || !isSceneMessage(event.data)) return
      const message = event.data
      if (message.type === 'talkie:ready') {
        loaded = true
        ref.current?.contentWindow?.postMessage(
          {
            type: 'talkie:init',
            fps,
            durationFrames: durationInFrames,
            width,
            height,
            params: scene.params ?? {},
            theme: sceneTheme,
            beats: (scene.beats ?? []).map((beat) => beat.at)
          },
          '*'
        )
        setReady(true)
        settle()
      } else if (message.type === 'talkie:drawn') {
        pending.current.get(message.id)?.()
        pending.current.delete(message.id)
      } else if (message.type === 'talkie:error') {
        console.error(`HTML scene "${scene.title}": ${message.message}`)
      }
    }
    window.addEventListener('message', onMessage)
    // A page that never loads is drawn as a card with its title, so the video still renders and
    // the failure is visible in it.
    const giveUp = setTimeout(() => {
      if (!loaded) {
        setFailed(true)
        settle()
      }
    }, LOAD_TIMEOUT_MS)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(giveUp)
    }
    // Loaded once per source; the theme and the frame reach the page by message.
  }, [scene.src])

  useEffect(() => {
    if (ready) ref.current?.contentWindow?.postMessage({ type: 'talkie:theme', theme: sceneTheme }, '*')
  }, [ready, theme?.stamp, variant])

  useEffect(() => {
    if (!ready || failed) return
    const id = nextId.current++
    const handle = rendering ? delayRender(`HTML scene "${scene.title}", frame ${frame}`) : null
    const timer = setTimeout(() => {
      console.error(`HTML scene "${scene.title}": frame ${frame} was not drawn within 5 s`)
      pending.current.delete(id)
      if (handle !== null) continueRender(handle)
    }, DRAW_TIMEOUT_MS)
    pending.current.set(id, () => {
      clearTimeout(timer)
      if (handle !== null) continueRender(handle)
    })
    ref.current?.contentWindow?.postMessage({ type: 'talkie:seek', frame, id }, '*')
  }, [frame, ready, failed])

  if (failed) {
    return (
      <AbsoluteFill
        style={{
          background: sceneTheme.background,
          color: sceneTheme.heading,
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: 72
        }}
      >
        {scene.title}
      </AbsoluteFill>
    )
  }

  return (
    <AbsoluteFill style={{ background: sceneTheme.background }}>
      <iframe
        ref={ref}
        src={scene.src}
        sandbox="allow-scripts"
        title={scene.title}
        width={width}
        height={height}
        style={{ border: 0, display: 'block' }}
      />
    </AbsoluteFill>
  )
}
