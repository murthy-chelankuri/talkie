import { createContext, useContext, useMemo, type CSSProperties, type ReactNode } from 'react'
import type { RenderMode, VideoConfig } from '../clock'

/**
 * Talkie's own frame clock. The host — the export page now, the editor's player in step 4 —
 * owns the frame and passes it in; scenes read it through the seam's hooks.
 */
type Clock = { frame: number; fps: number; width: number; height: number; durationInFrames: number; mode: RenderMode }
/** The enclosing Sequence, in absolute frames: where it starts and where it stops. */
type Span = { start: number; end: number }

const ClockContext = createContext<Clock | null>(null)
const SpanContext = createContext<Span>({ start: 0, end: Infinity })

/** The layout Remotion's AbsoluteFill had, which every scene was drawn against. */
export const FILL_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column'
}

export function VideoRoot({
  frame,
  fps,
  width,
  height,
  durationInFrames,
  mode,
  children
}: Clock & { children: ReactNode }): JSX.Element {
  const clock = useMemo(() => ({ frame, fps, width, height, durationInFrames, mode }), [frame, fps, width, height, durationInFrames, mode])
  const span = useMemo(() => ({ start: 0, end: durationInFrames }), [durationInFrames])
  return (
    <ClockContext.Provider value={clock}>
      <SpanContext.Provider value={span}>{children}</SpanContext.Provider>
    </ClockContext.Provider>
  )
}

function useClock(): Clock {
  const clock = useContext(ClockContext)
  if (!clock) throw new Error('Talkie’s clock is only available inside <VideoRoot>.')
  return clock
}

export function useOwnFrame(): number {
  return useClock().frame - useContext(SpanContext).start
}

export function useOwnVideoConfig(): VideoConfig {
  const { fps, width, height } = useClock()
  const { start, end } = useContext(SpanContext)
  return { fps, width, height, durationInFrames: end - start }
}

export function useOwnRenderMode(): RenderMode {
  return useClock().mode
}

export function OwnSequence({ from, durationInFrames = Infinity, children }: { from: number; durationInFrames?: number; children: ReactNode }): JSX.Element | null {
  const { frame } = useClock()
  const parent = useContext(SpanContext)
  const start = parent.start + from
  // Never past the parent's end: a take longer than its clip is cut where the clip ends.
  const end = Math.min(parent.end, start + durationInFrames)
  const span = useMemo(() => ({ start, end }), [start, end])
  if (frame < start || frame >= end) return null
  return (
    <SpanContext.Provider value={span}>
      <div style={FILL_STYLE}>{children}</div>
    </SpanContext.Provider>
  )
}

export function OwnFill({ style, children }: { style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return <div style={{ ...FILL_STYLE, ...style }}>{children}</div>
}
