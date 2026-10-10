import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { revealFrames, type Beat } from '../revealOnBeat'
import type { TextSceneData } from '../../main/project/timeline/schema'
import { resolveSceneTheme, type ResolvedSceneTheme } from '../sceneTheme'
import { useRenderTheme, type RenderTheme } from '../renderTheme'

/**
 * A slide written in the app.
 *
 * Its text carries a little formatting of its own, which is why it is set with innerHTML rather
 * than as a string — the markup has already been reduced to a handful of tags on the way in
 * (see richText.ts), so what reaches the renderer is only ever emphasis and colour.
 *
 * Lines arrive one after another rather than all at once, and where the narration is timed
 * each one waits for the sentence about it — see revealOnBeat.ts.
 */
export function TextScene({ data }: { data: unknown }): JSX.Element {
  const { title, bullets, style, beats, layout } = data as TextSceneData & { beats?: Beat[] }
  const project = useRenderTheme()
  const theme = resolveSceneTheme(style, project)
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()

  if (layout === 'title' || layout === 'closing') {
    return <Card layout={layout} title={title} look={theme} project={project} frame={frame} fps={fps} />
  }

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

  /**
   * When each line arrives, and whether it is arriving or settling.
   *
   * A timed take says when each point is spoken, so a line can wait for its own sentence
   * instead of appearing on a fixed stagger and being read twenty seconds early. That is a
   * real entrance, so it starts from nothing.
   *
   * Without timings nothing is known about when anything is said, and the old rule holds: the
   * lines settle rather than arrive, because a slide read for four seconds cannot spend its
   * first half-second empty. See revealOnBeat.ts.
   */
  const timed = (beats?.length ?? 0) > 0
  const reveals = revealFrames(bullets.length, beats ?? [], fps)

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
            const enter = spring({
              frame: frame - reveals[index],
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
                  opacity: interpolate(enter, [0, 1], [timed ? 0 : 0.7, 1]),
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

/**
 * The cards a theme puts at either end of a video: the logo large, and who it is from.
 *
 * Opening: the company, then the video's own title. Closing: the title — usually a thank-you or
 * the tagline — then the tagline and where to find them. Without a theme there is no company to
 * name, so a card is just its title, centred.
 */
function Card({
  layout,
  title,
  look,
  project,
  frame,
  fps
}: {
  layout: 'title' | 'closing'
  title: string
  look: ResolvedSceneTheme
  project: RenderTheme | null
  frame: number
  fps: number
}): JSX.Element {
  const settle = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 14 })
  const tagline = project?.tagline && project.tagline !== title ? project.tagline : ''

  return (
    <AbsoluteFill
      style={{
        background: look.background,
        padding: '9% 11%',
        justifyContent: 'center',
        alignItems: 'center',
        textAlign: 'center',
        fontFamily: look.bodyFont,
        gap: 36,
        opacity: interpolate(settle, [0, 1], [0.82, 1])
      }}
    >
      {project?.logo && (
        <Img src={project.logo.url} alt="" style={{ height: '18%', maxWidth: '50%', objectFit: 'contain' }} />
      )}
      {layout === 'title' && project?.company && (
        <span style={{ fontSize: 34, letterSpacing: 4, textTransform: 'uppercase', color: look.accent }}>
          {project.company}
        </span>
      )}
      <h1
        style={{ margin: 0, fontFamily: look.headingFont, fontSize: 104, lineHeight: 1.08, fontWeight: 500, color: look.heading }}
        dangerouslySetInnerHTML={{ __html: title }}
      />
      {layout === 'closing' && tagline && <p style={{ margin: 0, fontSize: 46, color: look.body }}>{tagline}</p>}
      {layout === 'closing' && project?.website && (
        <span style={{ fontSize: 38, color: look.accent }}>{project.website}</span>
      )}
    </AbsoluteFill>
  )
}
