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

/**
 * A diagram drawn from mermaid source.
 *
 * The SVG is fetched rather than generated here: mermaid is a large browser library, and making
 * the export renderer run it would be both slow and a way for the exported video to disagree
 * with the preview. What is drawn is exactly the SVG the editor drew.
 */
export function DiagramScene({ data }: { data: unknown }): JSX.Element {
  const { src, title, style } = data as DiagramSceneData
  const theme = resolveSceneTheme(style)
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
  const sized = useMemo(() => markup || null, [markup])

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
        {sized ? (
          <div
            style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            dangerouslySetInnerHTML={{ __html: sized }}
          />
        ) : (
          <span style={{ fontSize: 34, color: '#6b7280' }}>
            {src ? '' : 'This diagram has not been drawn yet.'}
          </span>
        )}
      </div>
    </AbsoluteFill>
  )
}
