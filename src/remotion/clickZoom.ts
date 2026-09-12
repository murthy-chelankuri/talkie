/**
 * Leaning in where something was clicked.
 *
 * A screen recording is a wide, even picture of a whole browser window, and the one thing it
 * cannot say is where to look. Editors solve this by hand, keyframing a zoom onto each click.
 * This app already knows: the recorder writes down where every click landed, so the same move
 * can be made without anyone asking for it.
 *
 * Deliberately small. A hard punch-in on every click is seasickness; this is closer to someone
 * leaning towards the screen and sitting back again.
 */
export interface ClickFocus {
  /** Frames from the start of the clip. */
  frame: number
  /** Where the click landed, as a share of the picture. */
  x: number
  y: number
}

export interface Zoom {
  scale: number
  /** Where to scale from, as a CSS transform-origin percentage. */
  originX: number
  originY: number
}

export const NO_ZOOM: Zoom = { scale: 1, originX: 50, originY: 50 }

/** How far in, and how long the move takes. */
const SCALE = 1.18
const LEAD_IN_FRAMES = 12
const HOLD_FRAMES = 26
const LEAD_OUT_FRAMES = 16

/** Below this apart, two clicks are one gesture and are held as a single move. */
const MERGE_WITHIN_FRAMES = LEAD_IN_FRAMES + HOLD_FRAMES

export function mergeFocuses(focuses: ClickFocus[]): ClickFocus[] {
  const sorted = [...focuses].sort((a, b) => a.frame - b.frame)
  const merged: ClickFocus[] = []

  for (const focus of sorted) {
    const last = merged[merged.length - 1]
    // Clicking twice in the same place, or twice in quick succession, is one moment of interest;
    // zooming out and straight back in reads as a flinch.
    if (last && focus.frame - last.frame < MERGE_WITHIN_FRAMES) continue
    merged.push(focus)
  }

  return merged
}

/**
 * The zoom at a given frame of a clip.
 *
 * Starts before the click rather than on it: the viewer should already be looking at the right
 * place when the thing happens, not be taken there afterwards.
 */
export function zoomAt(frame: number, focuses: ClickFocus[]): Zoom {
  for (const focus of focuses) {
    const start = focus.frame - LEAD_IN_FRAMES
    const end = focus.frame + HOLD_FRAMES + LEAD_OUT_FRAMES
    if (frame < start || frame > end) continue

    const progress =
      frame < focus.frame
        ? ease((frame - start) / LEAD_IN_FRAMES)
        : frame < focus.frame + HOLD_FRAMES
          ? 1
          : 1 - ease((frame - focus.frame - HOLD_FRAMES) / LEAD_OUT_FRAMES)

    return {
      scale: 1 + (SCALE - 1) * progress,
      originX: clampPercent(focus.x * 100),
      originY: clampPercent(focus.y * 100)
    }
  }

  return NO_ZOOM
}

/** Smooth at both ends, so the move has no corners in it. */
function ease(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped < 0.5 ? 2 * clamped * clamped : 1 - Math.pow(-2 * clamped + 2, 2) / 2
}

/**
 * Kept away from the very edge. Scaling from a corner leaves the opposite edge of the picture
 * short of the frame, which shows as a band of nothing.
 */
function clampPercent(value: number): number {
  return Math.min(85, Math.max(15, value))
}
