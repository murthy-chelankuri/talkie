/**
 * How far an export has got, as the window shows it.
 *
 * An export of a few minutes of video takes minutes, and for all of that the Export button only
 * said it was busy: nothing moved, nothing said how long, and nobody could tell a slow export
 * from a stuck one. So each step says what it is doing and the whole is one fraction, which is
 * what a bar and a time left can be drawn from.
 */
export type ExportStage = 'preparing' | 'rendering' | 'encoding' | 'finishing'

export type ExportProgress = {
  stage: ExportStage
  /** The whole export, 0 to 1 — not only the step it is on. */
  fraction: number
  renderedFrames: number
  totalFrames: number
}

/**
 * The share of the whole each step takes. Drawing frames is nearly all of it; getting ready
 * (redrawing diagrams, starting the browser) and finishing (levelling the sound, captions) are
 * a few seconds each, but they are given room so the bar does not sit at 0% or 100% through them.
 */
const PREPARING = 0.04
const FINISHING = 0.05

export function preparing(totalFrames = 0): ExportProgress {
  return { stage: 'preparing', fraction: 0, renderedFrames: 0, totalFrames }
}

/**
 * From Remotion's report while it draws and encodes: `progress` is its own 0–1 over both, and
 * `stitchStage` turns to `muxing` once every frame is drawn and the file is being put together.
 */
export function rendering(
  report: { progress: number; renderedFrames: number; stitchStage: 'encoding' | 'muxing' },
  totalFrames: number
): ExportProgress {
  const allDrawn = report.renderedFrames >= totalFrames && totalFrames > 0
  return {
    stage: report.stitchStage === 'muxing' || allDrawn ? 'encoding' : 'rendering',
    fraction: PREPARING + clamp(report.progress) * (1 - PREPARING - FINISHING),
    renderedFrames: Math.min(report.renderedFrames, totalFrames),
    totalFrames
  }
}

export function finishing(totalFrames: number): ExportProgress {
  return { stage: 'finishing', fraction: 1 - FINISHING, renderedFrames: totalFrames, totalFrames }
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/**
 * How an export ended, said rather than thrown.
 *
 * Thrown across IPC, a failure reached the window as "Error invoking remote method
 * 'project:render:export': Error: …", and a cancel looked exactly like a failure.
 */
export type ExportResult =
  | { status: 'done'; path: string; seconds: number }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }
