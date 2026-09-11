import type { ActionLogEntry } from '../capture/actionLog'

export interface CleanAction {
  /** Seconds from the start of the clip, so it lines up with the playhead. */
  atSeconds: number
  type: 'navigation' | 'click' | 'input' | 'annotation'
  label: string
}

export interface ClipWindow {
  startSeconds: number
  endSeconds: number
}

/** Query parameters that carry a real search term rather than tracking state. */
const SEARCH_PARAMS = ['q', 'query', 'search', 's']

/**
 * Parameters that only ever appear on ad-tech consent and cookie-sync endpoints. Keying off the
 * parameters rather than a list of hosts means this keeps working as ad networks come and go.
 */
const SYNC_PARAMS = ['gdpr', 'gdpr_consent', 'gpp', 'gpp_sid', 'us_privacy', 'coppa']

/** Navigations closer together than this were machinery, not a person clicking. */
const BURST_WINDOW_SECONDS = 1

/** Longer than any search a person types; past this it is an opaque token. */
const MAX_SEARCH_TERM_LENGTH = 60

/**
 * Turn a raw recording log into the handful of things worth narrating.
 *
 * The raw log is mostly noise: failed-resource console errors, duplicate navigation events, and
 * URLs that run to hundreds of characters of tracking parameters. What survives here is what a
 * person would actually mention when talking over the recording.
 */
export function cleanActionLog(entries: ActionLogEntry[], clip: ClipWindow): CleanAction[] {
  const actions: CleanAction[] = []
  let lastNavigationLabel: string | null = null
  let lastNavigationSeconds = Number.NEGATIVE_INFINITY

  for (const entry of entries) {
    const seconds = entry.t / 1000
    if (seconds < clip.startSeconds || seconds > clip.endSeconds) continue

    // Console errors are about how the page was built, never about what it shows.
    if (entry.type === 'console.error') continue

    const label = describe(entry)
    if (!label) continue

    if (entry.type === 'navigation') {
      if (isSyncEndpoint(entry.url)) continue
      if (label === lastNavigationLabel) continue
      // A burst of navigations is a page loading its own machinery; only the first was the user.
      if (seconds - lastNavigationSeconds < BURST_WINDOW_SECONDS) continue

      lastNavigationLabel = label
      lastNavigationSeconds = seconds
    }

    actions.push({
      atSeconds: round(seconds - clip.startSeconds),
      type: entry.type,
      label
    })
  }

  return actions
}

function describe(entry: ActionLogEntry): string | null {
  switch (entry.type) {
    case 'navigation':
      return entry.url ? describeUrl(entry.url) : null
    case 'click':
      return entry.text?.trim() ? `clicked "${entry.text.trim()}"` : `clicked ${entry.selector ?? 'something'}`
    case 'input':
      // A redacted value must never be reconstructed, so say only that typing happened.
      return entry.value && entry.value !== '[redacted]'
        ? `typed "${entry.value}" into ${entry.selector ?? 'a field'}`
        : `typed into ${entry.selector ?? 'a field'}`
    case 'annotation':
      return entry.annotation ? `marked ${entry.annotation}` : null
    default:
      return null
  }
}

function describeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return raw
  }

  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  const base = `${url.hostname}${path}`

  for (const key of SEARCH_PARAMS) {
    const term = url.searchParams.get(key)
    if (term && term.length <= MAX_SEARCH_TERM_LENGTH) return `${base} — searched for "${term}"`
  }

  return base
}

function isSyncEndpoint(raw: string | undefined): boolean {
  if (!raw) return false
  try {
    const params = new URL(raw).searchParams
    return SYNC_PARAMS.some((key) => params.has(key))
  } catch {
    return false
  }
}

function round(seconds: number): number {
  return Math.round(seconds * 1000) / 1000
}
