import { useEffect, useMemo, useState } from 'react'
import {
  AbsoluteFill,
  continueRender,
  delayRender,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from 'remotion'
import type { DiagramSceneData } from '../../main/project/timeline/schema'
import { resolveSceneTheme } from '../sceneTheme'
import { useRenderTheme } from '../renderTheme'
import { buildableDiagram, revealedThrough } from '../buildDiagram'
import { revealFrames, type Beat } from '../revealOnBeat'

/**
 * A diagram drawn from mermaid source.
 *
 * The SVG is fetched rather than generated here: mermaid is a large browser library, and making
 * the export renderer run it would be both slow and a way for the exported video to disagree
 * with the preview. What is drawn is exactly the SVG the editor drew.
 */
export function DiagramScene({ data }: { data: unknown }): JSX.Element {
  const { src, title, style, beats } = data as DiagramSceneData & { beats?: Beat[] }
  const theme = resolveSceneTheme(style, useRenderTheme())
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const [markup, setMarkup] = useState<string | null>(null)

  useEffect(() => {
    if (!src) return
    // The frame is held until the diagram is in hand, or the export would capture an empty one.
    const handle = delayRender(`Fetching diagram ${src}`)
    let cancelled = false

    fetch(src)
      .then((response) => response.text())
      .then((text) => {
        if (!cancelled) setMarkup(text)
      })
      .catch(() => {
        if (!cancelled) setMarkup('')
      })
      .finally(() => continueRender(handle))

    return () => {
      cancelled = true
    }
  }, [src])

  // Present on the first frame and settling, rather than arriving — see TextScene for why.
  const titleIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 })
  const drawIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 })

  // The SVG was normalised when it was drawn, so it already scales to whatever it is given.
  // Tagged here rather than on every frame: the markup goes into the document as one string,
  // and what changes frame to frame is only the stylesheet that hides the rest of it.
  const built = useMemo(() => (markup ? buildableDiagram(markup) : null), [markup])

  /**
   * How much of the diagram has been reached.
   *
   * A timed take says when each part is described, so the picture is drawn in the order it is
   * explained. Without timings the whole thing is there from the first frame, which is what it
   * always did — a diagram nobody is talking over has no order to follow.
   */
  const reveals = revealFrames(built?.steps ?? 0, beats ?? [], fps)
  const reached =
    !built || !beats?.length
      ? (built?.steps ?? 0)
      : reveals.filter((showAt) => frame >= showAt).length - 1

  return (
    <AbsoluteFill
      style={{
        background: theme.background,
        padding: title ? '6% 8% 8%' : '8%',
        fontFamily: theme.bodyFont
      }}
    >
      {title && (
        <h2
          style={{
            margin: '0 0 36px',
            fontFamily: theme.headingFont,
            fontSize: 64,
            fontWeight: 500,
            color: theme.heading,
            opacity: interpolate(titleIn, [0, 1], [0.82, 1]),
            transform: `translateY(${interpolate(titleIn, [0, 1], [10, 0])}px)`
          }}
        >
          <span dangerouslySetInnerHTML={{ __html: title }} />
        </h2>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 0,
          opacity: interpolate(drawIn, [0, 1], [0.75, 1]),
          transform: `scale(${interpolate(drawIn, [0, 1], [0.985, 1])})`
        }}
      >
        {built ? (
          <div
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {beats?.length ? <style>{revealedThrough(reached)}</style> : null}
            <div
              style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              dangerouslySetInnerHTML={{ __html: built.svg }}
            />
          </div>
        ) : (
          <span style={{ fontSize: 34, color: '#6b7280' }}>
            {src ? '' : 'This diagram has not been drawn yet.'}
          </span>
        )}
      </div>
    </AbsoluteFill>
  )
}
