import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ForwardedRef,
  type Ref
} from 'react'
import { VideoRoot } from './clock'
import { PreviewMediaContext, type PreviewMediaEntry, type RegisterPreviewMedia } from './previewMedia'
import type { PreviewEvents, PreviewHandle, PreviewProps } from '../preview'

/**
 * Talkie's own preview player. It owns the frame and advances
 * it from elapsed time while playing; the composition is drawn at each frame exactly as the export
 * draws it, so what plays is what renders. Its handle and events are the seam's (../preview.tsx),
 * so the transport bar, timeline, script and the three hosts do not know it changed.
 */

type EmitterListener = (event: { detail: unknown }) => void

/** The take playing now, which is the clock while it plays, and the frame it puts the composition at. */
function masterFrame(entries: PreviewMediaEntry[], frame: number, fps: number): { entry: PreviewMediaEntry; frame: number } | null {
  const master = entries.find(
    (e) => e.kind === 'audio' && frame >= e.startFrame && frame < e.endFrame && e.el.readyState >= 2 && !e.el.paused && !e.el.ended
  )
  if (!master) return null
  return { entry: master, frame: master.startFrame + master.el.currentTime * fps - master.trimBefore }
}

/**
 * Whether `want` seconds is at or beyond the end of the file — within a frame of it counts, since an
 * element that has ended reports its duration and the clock is only ever a frame from it. Unknown
 * until the element has its metadata, and then never past the end.
 */
function pastTheEnd(el: HTMLMediaElement, want: number, perFrame: number): boolean {
  return Number.isFinite(el.duration) && want >= el.duration - perFrame
}

function PlayerWith<P extends object>(
  { component, inputProps, durationInFrames, fps, width, height, controls, loop, autoPlay, style }: PreviewProps<P>,
  ref: ForwardedRef<PreviewHandle>
): JSX.Element {
  const [frame, setFrameState] = useState(0)
  const [playing, setPlayingState] = useState(false)
  const [muted, setMutedState] = useState(false)
  const [scale, setScale] = useState(1)

  const container = useRef<HTMLDivElement>(null)
  const media = useRef<Map<number, PreviewMediaEntry>>(new Map())
  const nextId = useRef(1)
  const base = useRef({ wallAt: 0, frame: 0 })
  const raf = useRef<number | null>(null)
  // Mirrors of the state the animation-frame loop reads without re-binding every render.
  const frameRef = useRef(0)
  const playingRef = useRef(false)
  const mutedRef = useRef(false)
  const fpsRef = useRef(fps)
  const durationRef = useRef(durationInFrames)
  const loopRef = useRef(!!loop)
  const listeners = useRef(new Map<keyof PreviewEvents, Set<EmitterListener>>())
  fpsRef.current = fps
  durationRef.current = durationInFrames
  loopRef.current = !!loop

  const emit = useCallback(<E extends keyof PreviewEvents>(event: E, detail: PreviewEvents[E]): void => {
    for (const listener of listeners.current.get(event) ?? []) listener({ detail })
  }, [])

  const showFrame = useCallback((next: number): void => {
    frameRef.current = next
    setFrameState(next)
    emit('frameupdate', { frame: next })
  }, [emit])

  // Puts every mounted element at the frame: those in their clip seeked there (left alone while
  // within a frame of it) and playing if the player is; those outside it paused. The master take
  // is the clock, so it is never seeked to itself.
  //
  // A clip usually runs on past the end of its take, so the frame can be inside the clip and past
  // the end of the file. That element is finished, not behind: play() on media that has ended
  // starts it again from the beginning, and the take, back to playing, became the clock again —
  // the playhead jumped to the start of the narration at the end of every take, and the preview
  // played the first scene over and over.
  const syncMedia = useCallback((at: number, except?: PreviewMediaEntry): void => {
    const perFrame = 1 / fpsRef.current
    for (const e of media.current.values()) {
      if (e === except) continue
      const want = (at - e.startFrame + e.trimBefore) * perFrame
      const inClip = at >= e.startFrame && at < e.endFrame && !pastTheEnd(e.el, want, perFrame)
      if (inClip) {
        if (e.el.readyState >= 1 && Math.abs(e.el.currentTime - want) > perFrame) {
          try {
            e.el.currentTime = want
          } catch {
            // A media element not ready to seek catches up once it is.
          }
        }
        if (playingRef.current && e.el.paused) void e.el.play().catch(() => undefined)
        else if (!playingRef.current && !e.el.paused) e.el.pause()
      } else if (!e.el.paused) {
        e.el.pause()
      }
    }
  }, [])

  const stop = useCallback((): void => {
    if (raf.current !== null) cancelAnimationFrame(raf.current)
    raf.current = null
  }, [])

  const pause = useCallback((): void => {
    if (!playingRef.current) return
    playingRef.current = false
    setPlayingState(false)
    stop()
    for (const e of media.current.values()) if (!e.el.paused) e.el.pause()
    emit('pause', undefined)
  }, [emit, stop])

  const seek = useCallback((to: number): void => {
    const clamped = Math.max(0, Math.min(Math.floor(to), Math.max(0, durationRef.current - 1)))
    base.current = { wallAt: performance.now(), frame: clamped }
    showFrame(clamped)
    syncMedia(clamped)
  }, [showFrame, syncMedia])

  const tick = useCallback((): void => {
    const now = performance.now()
    const entries = [...media.current.values()]
    const master = masterFrame(entries, frameRef.current, fpsRef.current)
    const next = master ? master.frame : base.current.frame + ((now - base.current.wallAt) / 1000) * fpsRef.current
    base.current = { wallAt: now, frame: next }
    if (next >= durationRef.current) {
      if (loopRef.current) {
        base.current = { wallAt: now, frame: 0 }
        showFrame(0)
        syncMedia(0)
        raf.current = requestAnimationFrame(tick)
        return
      }
      showFrame(durationRef.current - 1)
      pause()
      return
    }
    const shown = Math.max(0, Math.floor(next))
    showFrame(shown)
    syncMedia(shown, master?.entry)
    raf.current = requestAnimationFrame(tick)
  }, [pause, showFrame, syncMedia])

  const play = useCallback((): void => {
    if (playingRef.current || durationRef.current <= 0) return
    // At the end, Play starts over rather than sitting still.
    if (frameRef.current >= durationRef.current - 1) showFrame(0)
    playingRef.current = true
    setPlayingState(true)
    base.current = { wallAt: performance.now(), frame: frameRef.current }
    syncMedia(frameRef.current)
    emit('play', undefined)
    raf.current = requestAnimationFrame(tick)
  }, [emit, showFrame, syncMedia, tick])

  const applyMute = useCallback((next: boolean): void => {
    mutedRef.current = next
    setMutedState(next)
    for (const e of media.current.values()) if (e.kind === 'audio') e.el.muted = next
  }, [])

  const register = useCallback<RegisterPreviewMedia>((entry) => {
    const id = nextId.current++
    entry.el.muted = entry.kind === 'video' ? true : mutedRef.current
    media.current.set(id, entry)
    // Put it where the clock is at once: seeked into the clip if the frame is inside it (and
    // played if the player is), or held at its first frame while it preloads ahead of the cut.
    const at = frameRef.current
    const perFrame = 1 / fpsRef.current
    try {
      entry.el.currentTime = at >= entry.startFrame && at < entry.endFrame ? (at - entry.startFrame + entry.trimBefore) * perFrame : entry.trimBefore * perFrame
    } catch {
      // Caught up once the element can seek.
    }
    const want = (at - entry.startFrame + entry.trimBefore) * perFrame
    if (playingRef.current && at >= entry.startFrame && at < entry.endFrame && !pastTheEnd(entry.el, want, perFrame)) {
      void entry.el.play().catch(() => undefined)
    }
    return () => void media.current.delete(id)
  }, [])

  useImperativeHandle(
    ref,
    (): PreviewHandle => ({
      seekTo: (f) => seek(f),
      getCurrentFrame: () => frameRef.current,
      toggle: () => (playingRef.current ? pause() : play()),
      isPlaying: () => playingRef.current,
      mute: () => applyMute(true),
      unmute: () => applyMute(false),
      isMuted: () => mutedRef.current,
      requestFullscreen: () => void container.current?.requestFullscreen?.(),
      addEventListener: (event, listener) => {
        const set = listeners.current.get(event) ?? new Set()
        set.add(listener as EmitterListener)
        listeners.current.set(event, set)
      },
      removeEventListener: (event, listener) => listeners.current.get(event)?.delete(listener as EmitterListener)
    }),
    [seek, pause, play, applyMute]
  )

  // Draw at width×height and scale to fit, as the Player did: scenes use fixed pixel sizes.
  useLayoutEffect(() => {
    const el = container.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const rect = el.getBoundingClientRect()
      const fit = Math.min(rect.width / width, rect.height / height)
      setScale(fit > 0 && Number.isFinite(fit) ? fit : 1)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [width, height])

  useEffect(() => {
    if (autoPlay) play()
    return () => stop()
    // Only on mount: autoPlay is a one-time start, and stop() tidies the loop on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const Scene = component as ComponentType<Record<string, unknown>>

  return (
    <div
      ref={container}
      style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', ...style }}
    >
      <div style={{ width, height, flex: '0 0 auto', transform: `scale(${scale})`, transformOrigin: 'center center' }}>
        <PreviewMediaContext.Provider value={register}>
          <VideoRoot frame={frame} fps={fps} width={width} height={height} durationInFrames={durationInFrames} mode="preview">
            <Scene {...(inputProps as Record<string, unknown>)} />
          </VideoRoot>
        </PreviewMediaContext.Provider>
      </div>
      {controls && (
        <Controls
          playing={playing}
          muted={muted}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
          onToggle={() => (playingRef.current ? pause() : play())}
          onSeek={seek}
          onMute={() => applyMute(!mutedRef.current)}
          onFullscreen={() => void container.current?.requestFullscreen?.()}
        />
      )}
    </div>
  )
}

function clock(frame: number, fps: number): string {
  const total = Math.round(frame / fps)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Controls({
  playing,
  muted,
  frame,
  durationInFrames,
  fps,
  onToggle,
  onSeek,
  onMute,
  onFullscreen
}: {
  playing: boolean
  muted: boolean
  frame: number
  durationInFrames: number
  fps: number
  onToggle: () => void
  onSeek: (frame: number) => void
  onMute: () => void
  onFullscreen: () => void
}): JSX.Element {
  const button: CSSProperties = { background: 'none', border: 'none', color: '#fff', cursor: 'pointer', font: 'inherit', padding: '2px 6px' }
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
        color: '#fff',
        font: '12px system-ui, sans-serif'
      }}
    >
      <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={onToggle} style={button}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        aria-label="Seek"
        min={0}
        max={Math.max(0, durationInFrames - 1)}
        value={frame}
        onChange={(event) => onSeek(Number(event.target.value))}
        style={{ flex: 1 }}
      />
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {clock(frame, fps)} / {clock(Math.max(0, durationInFrames - 1), fps)}
      </span>
      <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={onMute} style={button}>
        {muted ? '🔇' : '🔊'}
      </button>
      <button type="button" aria-label="Fullscreen" onClick={onFullscreen} style={button}>
        ⛶
      </button>
    </div>
  )
}

export const OwnPreview = forwardRef(PlayerWith) as <P extends object>(
  props: PreviewProps<P> & { ref?: Ref<PreviewHandle> }
) => JSX.Element
