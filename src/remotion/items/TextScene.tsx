import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { TextSceneData } from '../../main/project/timeline/schema'

/**
 * A slide written in the app.
 *
 * The look is the app's own — graphite, brass, and the serif the interface uses for headings —
 * so a scene made in Talkie sits in the same demo as a recording without looking borrowed from
 * somewhere else. Lines arrive one after another rather than all at once, which is what gives a
 * narrator something to talk over.
 */
export function TextScene({ data }: { data: unknown }): JSX.Element {
  const { title, bullets } = data as TextSceneData
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  const titleIn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 })

  return (
    <AbsoluteFill
      style={{
        background: 'linear-gradient(160deg, #232833 0%, #171b22 55%, #101318 100%)',
        padding: '9% 11%',
        justifyContent: 'center',
        fontFamily: 'Geist Variable, ui-sans-serif, system-ui, sans-serif'
      }}
    >
      <div
        style={{
          opacity: titleIn,
          transform: `translateY(${interpolate(titleIn, [0, 1], [26, 0])}px)`
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: 'Newsreader Variable, ui-serif, Georgia, serif',
            fontSize: 92,
            lineHeight: 1.08,
            fontWeight: 500,
            color: '#f4f6f9'
          }}
        >
          {title}
        </h1>
        {/* The one brass mark on the slide, drawn out rather than simply appearing. */}
        <div
          style={{
            marginTop: 34,
            height: 5,
            width: `${interpolate(titleIn, [0, 1], [0, 132])}px`,
            borderRadius: 3,
            background: '#d3a24c'
          }}
        />
      </div>

      {bullets.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '56px 0 0', padding: 0 }}>
          {bullets.map((bullet, index) => {
            // Each line waits its turn, so the narration has room to reach it.
            const enter = spring({
              frame: frame - 14 - index * 9,
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
                  gap: 22,
                  marginBottom: 30,
                  opacity: enter,
                  transform: `translateY(${interpolate(enter, [0, 1], [18, 0])}px)`
                }}
              >
                <span style={{ width: 10, height: 10, borderRadius: 5, background: '#d3a24c', flexShrink: 0 }} />
                <span style={{ fontSize: 46, lineHeight: 1.35, color: '#c9cedb' }}>{bullet}</span>
              </li>
            )
          })}
        </ul>
      )}
    </AbsoluteFill>
  )
}
