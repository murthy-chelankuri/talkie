/**
 * Which renderer draws this page: Remotion, as the editor's player and Remotion's export bundle
 * still do, or Talkie's own, as the export page does. Chosen once, by the page, before anything
 * renders — the two run as separate bundles, so a module-level choice is per page, and every
 * hook that consults it is called in the same order on every render.
 */
let own = false

export function chooseOwnRenderer(): void {
  own = true
}

export function isOwnRenderer(): boolean {
  return own
}
