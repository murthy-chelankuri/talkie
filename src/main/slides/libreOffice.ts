import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { basename, join } from 'path'

const execFileAsync = promisify(execFile)

/** Where LibreOffice puts its binary when installed the usual ways. */
const CANDIDATE_PATHS = [
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/opt/homebrew/bin/soffice',
  '/usr/local/bin/soffice',
  '/usr/bin/soffice'
]

const CONVERT_TIMEOUT_MS = 180_000

/**
 * Find LibreOffice, which is what turns a .pptx into something renderable.
 *
 * It is optional on purpose: without it a .pdf still imports, so a large install is never
 * forced on someone who can export a PDF instead.
 */
export function findLibreOffice(): string | null {
  return CANDIDATE_PATHS.find((path) => existsSync(path)) ?? null
}

/**
 * Convert a presentation to PDF, which is the one format both LibreOffice writes reliably and
 * this app can rasterise page by page.
 */
export async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  const soffice = findLibreOffice()
  if (!soffice) {
    throw new Error('LibreOffice is not installed.')
  }

  await execFileAsync(
    soffice,
    ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, inputPath],
    { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
  )

  const pdfPath = join(outputDir, `${basename(inputPath).replace(/\.[^.]+$/, '')}.pdf`)
  if (!existsSync(pdfPath)) {
    throw new Error(`LibreOffice ran but produced no PDF for ${basename(inputPath)}.`)
  }

  return pdfPath
}
