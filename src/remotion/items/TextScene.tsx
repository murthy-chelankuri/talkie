import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { TextSceneData } from '../../main/project/timeline/schema'
import { resolveSceneTheme } from '../sceneTheme'

/**
 * A slide written in the app.
 *
 * Its text carries a little formatting of its own, which is why it is set with innerHTML rather
 * than as a string — the markup has already been reduced to a handful of tags on the way in
 * (see richText.ts), so what reaches the renderer is only ever emphasis and colour.
 *
 * Lines arrive one after another rather than all at once, which is what gives a narrator
 * something to talk over.
 */
export function TextScene({ data }: { data: unknown }): JSX.Element {
  const { title, bullets, style } = data as TextSceneData
  const theme = resolveSceneTheme(style)
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  /**
   * A settle, not an entrance.
   *
   * These used to start at nothing and fade up, which meant the first frame of every slide was
   * empty — and when a slide opened the project, so was the first frame of the whole video: the
   * frame every player, unfurl and thumbnail shows before anyone presses play. A slide that is
   * read for four seconds cannot spend the first half-second arriving.
   */
  const titleIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 })
  const centred = theme.align === 'center'

  return (
    <AbsoluteFill
      style={{
        background: theme.background,
        padding: '9% 11%',
        justifyContent: 'center',
        alignItems: centred ? 'center' : 'stretch',
        textAlign: theme.align,
        fontFamily: theme.bodyFont
      }}
    >
      <div
        style={{
          opacity: interpolate(titleIn, [0, 1], [0.82, 1]),
          transform: `translateY(${interpolate(titleIn, [0, 1], [12, 0])}px)`
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: theme.headingFont,
            fontSize: theme.headingSize,
            lineHeight: 1.08,
            fontWeight: 500,
            color: theme.heading
          }}
          dangerouslySetInnerHTML={{ __html: title }}
        />
        {/* The one accent mark on the slide, drawn out rather than simply appearing. */}
        <div
          style={{
            marginTop: 34,
            marginLeft: centred ? 'auto' : undefined,
            marginRight: centred ? 'auto' : undefined,
            height: 5,
            width: `${interpolate(titleIn, [0, 1], [0, 132])}px`,
            borderRadius: 3,
            background: theme.accent
          }}
        />
      </div>

      {bullets.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '56px 0 0', padding: 0 }}>
          {bullets.map((bullet, index) => {
            // Each line waits its turn, so the narration has room to reach it.
            const enter = spring({
              frame: frame - index * 6,
              fps,
              config: { damping: 200 },
              durationInFrames: 16
            })

            return (
              <li
                key={`${index}-${bullet}`}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: centred ? 'center' : 'flex-start',
                  gap: 22,
                  marginBottom: 30,
                  opacity: interpolate(enter, [0, 1], [0.7, 1]),
                  transform: `translateY(${interpolate(enter, [0, 1], [10, 0])}px)`
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: theme.accent,
                    flexShrink: 0
                  }}
                />
                <span
                  style={{ fontSize: theme.bodySize, lineHeight: 1.35, color: theme.body }}
                  dangerouslySetInnerHTML={{ __html: bullet }}
                />
              </li>
            )
          })}
        </ul>
      )}
    </AbsoluteFill>
  )
}
