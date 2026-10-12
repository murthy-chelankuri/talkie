/**
 * What the renderer may ask the system for.
 *
 * Deny by default, and name the exceptions. Electron grants nothing unless asked, and the list
 * it can be asked for includes the camera, the screen, the clipboard and the user's location —
 * none of which this app has any business with.
 */

/**
 * The three it does have business with.
 *
 * `media` is the microphone, for recording a narration take in your own voice. `fullscreen` is
 * the preview filling the screen, which is the one thing a person watching a demo obviously
 * wants — and which was denied by a rule that named only the microphone, so the button did
 * nothing and said nothing. `clipboard-sanitized-write` is what `navigator.clipboard.writeText`
 * asks for: without it every Copy button — the MCP token among them — quietly copied nothing.
 * It only puts text on the clipboard; reading it back is `clipboard-read`, which stays refused,
 * because whatever the person last copied elsewhere is none of the app's business.
 */
const ALLOWED = new Set(['media', 'fullscreen', 'clipboard-sanitized-write'])

export function mayUse(permission: string): boolean {
  return ALLOWED.has(permission)
}
