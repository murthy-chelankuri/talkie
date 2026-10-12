import type { Session } from 'electron'

/**
 * What the renderer is allowed to load, and where it is allowed to talk to.
 *
 * The renderer holds the bridge to everything the app can do — reading settings, writing project
 * files, opening paths through the shell. Script injected into it inherits all of that, and until
 * now nothing constrained where such a script could send what it found. `connect-src` is the line
 * that matters most here: the app's own outbound calls to model and speech services are made in
 * the main process, so the renderer has no legitimate reason to reach the network at all beyond
 * the local asset server.
 *
 * This is the second half of a pair. The first is the sanitiser that keeps injected markup out of
 * the scene fields; this is what limits the damage if something ever gets past it.
 */

/** The loopback asset server, which serves each project's own media on an ephemeral port. */
const ASSET_SERVER = 'http://127.0.0.1:*'
// frame-src: HTML scenes play in a sandboxed frame served by the asset server — see
// htmlScene/policy.ts. Nothing else is ever framed.

/**
 * Inline styles are unavoidable here: the interface positions waveforms, clip blocks and the
 * timeline with computed `style` attributes, which CSP counts as inline regardless of who wrote
 * them. Scripts are not given the same latitude.
 */
/**
 * `data:` in media-src is for Remotion's player, which starts each of its shared audio tags on a
 * tiny silent MP3 written inline. Refused, every preview logged a policy violation per tag, and
 * an error that is always there hides the one that is new. Audio cannot run script.
 */
const PRODUCTION_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' 'unsafe-inline'`,
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${ASSET_SERVER}`,
  `media-src 'self' data: blob: ${ASSET_SERVER}`,
  `connect-src 'self' data: blob: ${ASSET_SERVER}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  `frame-src ${ASSET_SERVER}`,
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

/**
 * The dev server compiles in the browser and pushes updates over a socket, which needs both
 * `eval` and an open connection back to Vite. Loosened knowingly and only here: the packaged app
 * never runs this policy, and it is the packaged app that meets anything untrusted.
 */
const DEVELOPMENT_POLICY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `style-src 'self' 'unsafe-inline'`,
  "font-src 'self' data:",
  `img-src 'self' data: blob: ${ASSET_SERVER}`,
  `media-src 'self' data: blob: ${ASSET_SERVER}`,
  `connect-src 'self' data: blob: ws: http://localhost:* ${ASSET_SERVER}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  `frame-src ${ASSET_SERVER}`,
  "base-uri 'none'",
  "form-action 'none'"
].join('; ')

export function contentSecurityPolicy(isDevelopment: boolean): string {
  return isDevelopment ? DEVELOPMENT_POLICY : PRODUCTION_POLICY
}

/**
 * Applied as a response header rather than as a meta tag in the HTML.
 *
 * A meta tag covers only the document that carries it, and is itself a thing injected markup
 * could sit above. A header is attached by the process the renderer cannot reach.
 */
export function applyContentSecurityPolicy(session: Session, isDevelopment: boolean): void {
  const policy = contentSecurityPolicy(isDevelopment)

  session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}
