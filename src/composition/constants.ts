export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
export const COMPOSITION_ID = 'Demo'

/**
 * A beat of silence before the narration starts, so a new slide is seen before it is talked
 * over, and the voice does not begin mid-cut.
 */
export const NARRATION_LEAD_IN_FRAMES = Math.round(FPS * 0.6)

/**
 * A beat after the narration ends, so a clip is not cut the instant the last word lands and the
 * viewer has a moment to take in what was said.
 */
export const NARRATION_TAIL_FRAMES = Math.round(FPS * 0.9)
