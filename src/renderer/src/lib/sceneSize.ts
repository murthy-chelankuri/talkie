/**
 * How big one scene is drawn in the script, when someone has dragged it larger.
 *
 * Width drives the type: a scene dragged to twice its width reads at twice the size, up to a
 * limit, so dragging the corner works like zooming that one scene. Height only adds room below
 * the words, since the box already grows with what is written in it.
 */
export type SceneSize = { width: number; height: number }

/** The column a scene is set in until it is dragged. */
export const BASE_WIDTH = 640
export const BASE_TEXT_PX = 15
const MAX_TEXT_PX = 30

export function textPxFor(width: number): number {
  return Math.min(MAX_TEXT_PX, Math.max(BASE_TEXT_PX, Math.round((BASE_TEXT_PX * width) / BASE_WIDTH)))
}

/**
 * Where a drag of the bottom-right corner leaves the scene. The scene is centred, so its right
 * edge moves half as far as its width changes — the width moves twice the pointer to keep the
 * corner under it.
 */
export function resized(start: SceneSize, dx: number, dy: number, maxWidth: number): SceneSize {
  return {
    width: Math.round(Math.min(Math.max(BASE_WIDTH, maxWidth), Math.max(BASE_WIDTH, start.width + dx * 2))),
    height: Math.round(Math.max(0, start.height + dy))
  }
}

export function isBaseSize(size: SceneSize | undefined): boolean {
  return !size || (size.width <= BASE_WIDTH && size.height <= 0)
}
