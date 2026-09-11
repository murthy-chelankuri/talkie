import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// pdfjs does its parsing in a worker. Bundling the worker rather than fetching it from a CDN
// keeps slide import working with no network.
//
// Pinned to the 4.x line on purpose: 6.x calls Uint8Array.prototype.toHex, which the Chromium
// in Electron 32 does not have, and slide import fails at runtime with "n.toHex is not a
// function". Raising this needs Electron raised first.
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Slides are rendered to fit the composition, so a wide deck is not upscaled past its detail. */
const TARGET_WIDTH = 1920

export interface RenderedPage {
  png: Uint8Array
}

/**
 * Turn each page of a PDF into a PNG.
 *
 * This runs in the renderer because that is where a real canvas lives: rasterising in the main
 * process would need a native canvas build, and Electron already ships the one Chromium uses.
 */
export async function renderPdfPages(
  pdfBytes: Uint8Array,
  onProgress?: (done: number, total: number) => void
): Promise<RenderedPage[]> {
  // pdfjs takes ownership of the buffer it is given, so hand it a copy the caller still holds.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdfBytes) })
  const document = await loadingTask.promise
  const pages: RenderedPage[] = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const unscaled = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: TARGET_WIDTH / unscaled.width })

      const canvas = window.document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)

      const context = canvas.getContext('2d')
      if (!context) throw new Error('This machine could not provide a canvas to draw slides on.')

      // Slides assume a white page; without this a transparent PDF background renders black.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)

      await page.render({ canvasContext: context, viewport }).promise
      pages.push({ png: await toPng(canvas) })

      page.cleanup()
      onProgress?.(pageNumber, document.numPages)
    }
  } finally {
    // Releasing the task tears down the worker with it.
    await loadingTask.destroy()
  }

  return pages
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('A slide could not be converted to an image.')
  return new Uint8Array(await blob.arrayBuffer())
}
