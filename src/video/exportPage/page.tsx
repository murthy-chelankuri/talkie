import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { DemoComposition } from '../../remotion/DemoComposition'
import type { TimelineItem } from '../../remotion/types'
import type { RenderTheme } from '../../remotion/renderTheme'
import { setFrameReader, VideoRoot, whenSettled } from '..'

/**
 * The page the export draws in: the same composition the preview plays, on Talkie's own clock.
 * One per tab. The exporter loads it, then asks for each frame of its range in turn and takes a
 * screenshot once the frame says it is drawn.
 */
export type ExportPageInput = {
  timeline: TimelineItem[]
  theme: RenderTheme | null
  fps: number
  width: number
  height: number
  durationInFrames: number
  reader: string
}

let root: Root | null = null
let input: ExportPageInput | null = null

function draw(frame: number): void {
  if (!root || !input) throw new Error('The export page has not been loaded.')
  const { timeline, theme, fps, width, height, durationInFrames } = input
  // Synchronously, so the frame's effects — and the holds they open — exist before we wait.
  flushSync(() =>
    root!.render(
      <VideoRoot frame={frame} fps={fps} width={width} height={height} durationInFrames={durationInFrames} mode="export">
        <DemoComposition timeline={timeline} theme={theme} />
      </VideoRoot>
    )
  )
}

const nextPaint = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))

async function settle(): Promise<void> {
  // Passive effects of a synchronous render have run by now; a task boundary makes sure.
  await new Promise((resolve) => setTimeout(resolve, 0))
  await whenSettled()
  await nextPaint()
}

declare global {
  interface Window {
    talkie: { load: (input: ExportPageInput) => Promise<void>; seek: (frame: number) => Promise<void> }
  }
}

window.talkie = {
  async load(given) {
    input = given
    setFrameReader(given.reader)
    const element = document.getElementById('root')!
    element.style.width = `${given.width}px`
    element.style.height = `${given.height}px`
    root = createRoot(element)
    draw(0)
    await document.fonts.ready
    await settle()
  },
  async seek(frame) {
    draw(frame)
    try {
      await settle()
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)} (frame ${frame})`)
    }
  }
}
