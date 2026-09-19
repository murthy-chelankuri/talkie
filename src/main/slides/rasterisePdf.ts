import type { SlidePage } from './importSlides'

/**
 * Turn each page of a PDF into a PNG, here rather than in the renderer.
 *
 * The app rasterises slides in the renderer because that is where Chromium's own canvas
 * already is — see renderPdfPages.ts, which stays as it is. An agent has no renderer: the MCP
 * server is a plain Node process, and deck import was the one thing it could not be given a
 * tool for.
 *
 * It turns out not to need one. `pdfjs-dist` is already a dependency and already brings
 * `@napi-rs/canvas` with it as an optional dependency, so the same library that draws the
 * pages in the window can draw them here. Both are loaded on demand: the canvas is a native
 * module, and nothing that does not import a deck should pay for loading it.
 */

/** Slides are rendered to fit the composition, so a wide deck is not upscaled past its detail. */
const TARGET_WIDTH = 1920

export async function rasterisePdf(pdfBytes: Uint8Array): Promise<SlidePage[]> {
  // The legacy build is the one meant for Node; the default entry expects a browser.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createCanvas } = await import('@napi-rs/canvas')

  // pdfjs takes ownership of the buffer it is given, so hand it a copy the caller still holds.
  const loading = pdfjs.getDocument({ data: new Uint8Array(pdfBytes) })
  const document = await loading.promise

  try {
    const pages: SlidePage[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const unscaled = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: TARGET_WIDTH / unscaled.width })

      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
        viewport
      }).promise

      pages.push({ png: new Uint8Array(canvas.toBuffer('image/png')) })
      page.cleanup()
    }
    return pages
  } finally {
    // The loading task owns the worker, so this is what shuts it down — a server that imported
    // a deck and left one running would never be idle again.
    await loading.destroy()
  }
}
