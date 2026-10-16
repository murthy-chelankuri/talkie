import { homedir, tmpdir } from 'os'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { randomUUID } from 'crypto'
import { findProjectDir } from '../project/paths'
import {
  addTimelineItem,
  addTranscriptSegment,
  readTimeline,
  DEFAULT_IMAGE_DURATION_FRAMES
} from '../project/projectApi'
import { readPptxNotes } from './pptxNotes'
import { readPptxSlideTexts } from './pptxSlides'
import { slideTextOrNull, type SlideText } from './slideText'
import { convertToPdf, findLibreOffice } from './libreOffice'
import { TextSceneDataSchema, type TimelineItem } from '../project/timeline/schema'

export type PreparedDeck =
  /** Ready to rasterise: the renderer turns these bytes into one image per page. */
  | {
      status: 'ready'
      pdf: Uint8Array
      notes: string[]
      name: string
      /** A .pptx's own words per slide, read from its XML; better than reading them off the PDF. */
      texts?: SlideText[]
    }
  /**
   * A .pptx that cannot be rendered here. The notes were still readable, so they are carried
   * back and applied to the PDF the user exports instead.
   */
  | { status: 'needs-pdf'; notes: string[]; name: string; reason: string }
  | { status: 'cancelled' }

/**
 * Turn a chosen presentation into something renderable.
 *
 * A .pdf is already there. A .pptx needs LibreOffice, which is optional — without it the deck
 * still gives up its speaker notes, so the user is asked for a PDF rather than turned away.
 */
export async function prepareDeck(filePath: string): Promise<PreparedDeck> {
  const name = filePath.split('/').pop() ?? 'deck'

  if (extname(filePath).toLowerCase() === '.pdf') {
    return { status: 'ready', pdf: new Uint8Array(readFileSync(filePath)), notes: [], name }
  }

  const notes = await readPptxNotes(filePath)
  const texts = await readPptxSlideTexts(filePath)

  if (!findLibreOffice()) {
    return {
      status: 'needs-pdf',
      notes,
      name,
      reason:
        'Rendering a .pptx needs LibreOffice, which is not installed. Export the deck as a PDF and choose it instead — the speaker notes from this file will still be used.'
    }
  }

  const workDir = mkdtempSync(join(tmpdir(), 'talkie-deck-'))
  try {
    const pdfPath = await convertToPdf(filePath, workDir)
    return { status: 'ready', pdf: new Uint8Array(readFileSync(pdfPath)), notes, name, texts }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

export interface SlidePage {
  /** PNG bytes for one rendered page. */
  png: Uint8Array
  /** The words read off the page, where it was drawn from a PDF. */
  text?: SlideText
}

/**
 * Add a deck's pages to the timeline as slides, with their speaker notes as narration.
 *
 * Each page becomes a Talkie slide — its title and points, editable and in the project's theme —
 * holding the page's picture as well, so it can be shown as it was instead (`showPicture`). A
 * page with no words to read, a full-bleed photo or a chart on its own, starts as its picture.
 * The words come from the .pptx itself where there was one (`texts`), and are read off the PDF
 * otherwise.
 *
 * Notes are stored as the user's own words rather than an agent draft, so auto-drafting will
 * never overwrite a script they already wrote in PowerPoint.
 */
export function saveSlides(
  projectId: string,
  pages: SlidePage[],
  notes: string[],
  baseDir: string = homedir(),
  texts: SlideText[] = []
): TimelineItem[] {
  const dir = findProjectDir(projectId, baseDir)
  if (!dir) {
    throw new Error(`No project found with id ${projectId}`)
  }

  const slidesDir = join(dir, 'sources', 'slides')
  mkdirSync(slidesDir, { recursive: true })

  const timeline = readTimeline(projectId, baseDir)
  let start = timeline.length === 0 ? 0 : Math.max(...timeline.map((item) => item.start + item.duration))

  const added: TimelineItem[] = []
  for (const [index, page] of pages.entries()) {
    const imagePath = join(slidesDir, `${randomUUID()}-slide-${index + 1}.png`)
    writeFileSync(imagePath, page.png)

    const words = slideTextOrNull(texts[index]) ?? slideTextOrNull(page.text)
    const item = addTimelineItem(
      projectId,
      {
        kind: 'scene',
        start,
        duration: DEFAULT_IMAGE_DURATION_FRAMES,
        data: TextSceneDataSchema.parse({
          title: words?.title ?? '',
          bullets: words?.bullets ?? [],
          picture: imagePath,
          ...(words ? {} : { showPicture: true })
        })
      },
      baseDir
    )
    start += DEFAULT_IMAGE_DURATION_FRAMES
    added.push(item)

    const note = notes[index]?.trim()
    if (note) {
      addTranscriptSegment(projectId, { text: note, timelineItemId: item.id }, baseDir)
    }
  }

  return added
}
