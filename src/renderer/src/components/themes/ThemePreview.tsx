import { useEffect, useMemo, useState } from 'react'
import { Preview } from '../../../../video/preview'
import { DemoComposition } from '../../../../composition/DemoComposition'
import { FPS, HEIGHT, WIDTH } from '../../../../composition/constants'
import type { TimelineItem } from '../../../../composition/types'
import { themeClient, type RenderTheme, type ThemeDraft, type ThemeTarget } from '../../api/projectClient'

const SCENE = 75

/**
 * A short reel through everything a theme touches — each variant of a slide, the opening card,
 * a caption, a diagram — played by the same composition that renders the video. Not a mock-up:
 * a preview drawn any other way would be a second opinion about what the export will look like.
 */
function sampleTimeline(draft: ThemeDraft): TimelineItem[] {
  const slide = (id: string, n: number, data: object): TimelineItem => ({
    id,
    kind: 'scene',
    start: n * SCENE,
    duration: SCENE,
    data: { bullets: [], layout: 'standard', ...data }
  })
  return [
    slide('title', 0, { title: draft.company || draft.name, layout: 'title', style: { theme: 'brand', align: 'center' } }),
    slide('brand', 1, { title: 'Your brand, on every slide', bullets: ['Brand variant', 'Lines arrive as they are spoken'], style: { theme: 'brand' } }),
    slide('light', 2, {
      title: 'A lighter slide',
      bullets: ['Light variant', 'Captions follow the theme too'],
      style: { theme: 'light' },
      captions: [{ startFrame: 10, endFrame: SCENE, text: 'This is how captions will look.' }]
    }),
    slide('dark', 3, { title: 'And a darker one', bullets: ['Dark variant'], style: { theme: 'dark' } }),
    slide('closing', 4, { title: draft.tagline || draft.company || draft.name, layout: 'closing', style: { theme: 'brand', align: 'center' } })
  ]
}

export function ThemePreview({ draft, target }: { draft: ThemeDraft; target: ThemeTarget }): JSX.Element {
  const [theme, setTheme] = useState<RenderTheme | null>(null)
  const timeline = useMemo(() => sampleTimeline(draft), [draft])

  // Debounced: a colour picker reports every pixel it is dragged across.
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      themeClient
        .render(draft, target)
        .then((next) => {
          if (!cancelled) setTheme(next)
        })
        .catch(() => undefined)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft, target])

  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-[#0c0d11] ring-1 ring-border">
      {theme && (
        <Preview
          component={DemoComposition}
          inputProps={{ timeline, theme }}
          durationInFrames={timeline.length * SCENE}
          fps={FPS}
          width={WIDTH}
          height={HEIGHT}
          style={{ width: '100%', height: '100%' }}
          controls
          loop
          autoPlay
        />
      )}
    </div>
  )
}
