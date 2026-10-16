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
import { convertToPdf, findLibreOffice } from './libreOffice'
import type { TimelineItem } from '../project/timeline/schema'

export type PreparedDeck =
  /** Ready to rasterise: the renderer turns these bytes into one image per page. */
  | { status: 'ready'; pdf: Uint8Array; notes: string[]; name: string }
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
    return { status: 'ready', pdf: new Uint8Array(readFileSync(pdfPath)), notes, name }
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

export interface SlidePage {
  /** PNG bytes for one rendered page. */
  png: Uint8Array
}

/**
 * Add rendered slides to the timeline, with their speaker notes as narration.
 *
 * Notes are stored as the user's own words rather than an agent draft, so auto-drafting will
 * never overwrite a script they already wrote in PowerPoint.
 */
export function saveSlides(
  projectId: string,
  pages: SlidePage[],
  notes: string[],
  baseDir: string = homedir()
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

    const item = addTimelineItem(
      projectId,
      { kind: 'image', start, duration: DEFAULT_IMAGE_DURATION_FRAMES, data: { src: imagePath } },
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
