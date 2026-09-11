import { describe, expect, it } from 'vitest'
import { cleanActionLog } from './cleanActionLog'
import type { ActionLogEntry } from '../capture/actionLog'

const FULL_CLIP = { startSeconds: 0, endSeconds: 3600 }

describe('cleanActionLog', () => {
  it('drops console errors, which say nothing about what the demo shows', () => {
    const entries: ActionLogEntry[] = [
      { t: 100, type: 'navigation', url: 'https://example.com/' },
      { t: 200, type: 'console.error', text: 'Failed to load resource: the server responded with a status of 422 ()' }
    ]

    expect(cleanActionLog(entries, FULL_CLIP)).toEqual([
      { atSeconds: 0.1, type: 'navigation', label: 'example.com' }
    ])
  })

  it('keeps a search term but throws away the tracking soup around it', () => {
    const url =
      'https://www.google.com/search?q=about+llm+models&sca_esv=e051c0c7&ei=TXahavmeI&ved=0ahUKEwi5&gs_lp=Egdnd3Mtd2l6'
    const entries: ActionLogEntry[] = [{ t: 1000, type: 'navigation', url }]

    expect(cleanActionLog(entries, FULL_CLIP)[0].label).toBe('www.google.com/search — searched for "about llm models"')
  })

  it('shortens a long path-only url to host and path', () => {
    const entries: ActionLogEntry[] = [
      { t: 0, type: 'navigation', url: 'https://www.eenadu.net/telugu-news/politics?ref=hp&utm_source=x' }
    ]

    expect(cleanActionLog(entries, FULL_CLIP)[0].label).toBe('www.eenadu.net/telugu-news/politics')
  })

  it('collapses the duplicate navigations the recorder emits', () => {
    const entries: ActionLogEntry[] = [
      { t: 173, type: 'navigation', url: 'https://www.google.com/' },
      { t: 309, type: 'navigation', url: 'https://www.google.com/' },
      { t: 10780, type: 'navigation', url: 'https://www.eenadu.net/' }
    ]

    expect(cleanActionLog(entries, FULL_CLIP).map((a) => a.label)).toEqual(['www.google.com', 'www.eenadu.net'])
  })

  it('describes a click by its text when the recorder captured any', () => {
    const entries: ActionLogEntry[] = [{ t: 500, type: 'click', selector: '#submit', text: 'Buy now' }]

    expect(cleanActionLog(entries, FULL_CLIP)[0].label).toBe('clicked "Buy now"')
  })

  it('falls back to the selector when the click text is empty', () => {
    const entries: ActionLogEntry[] = [{ t: 500, type: 'click', selector: '#ti6dpd', text: '' }]

    expect(cleanActionLog(entries, FULL_CLIP)[0].label).toBe('clicked #ti6dpd')
  })

  it('reports typing without ever repeating a redacted value', () => {
    const entries: ActionLogEntry[] = [
      { t: 500, type: 'input', selector: '#email', value: 'ada@example.com' },
      { t: 700, type: 'input', selector: '#password', value: '[redacted]' }
    ]

    const labels = cleanActionLog(entries, FULL_CLIP).map((a) => a.label)
    expect(labels[0]).toBe('typed "ada@example.com" into #email')
    expect(labels[1]).toBe('typed into #password')
  })

  it('keeps the annotations, which are the only record of what the user meant', () => {
    const entries: ActionLogEntry[] = [{ t: 2000, type: 'annotation', annotation: 'important' }]

    expect(cleanActionLog(entries, FULL_CLIP)[0]).toEqual({
      atSeconds: 2,
      type: 'annotation',
      label: 'marked important'
    })
  })

  it('keeps only what happened while this clip was on screen', () => {
    const entries: ActionLogEntry[] = [
      { t: 1000, type: 'click', selector: '#a', text: 'before' },
      { t: 5000, type: 'click', selector: '#b', text: 'during' },
      { t: 9000, type: 'click', selector: '#c', text: 'after' }
    ]

    const kept = cleanActionLog(entries, { startSeconds: 4, endSeconds: 8 })

    expect(kept.map((a) => a.label)).toEqual(['clicked "during"'])
  })

  it('times actions from the start of the clip, not the start of the recording', () => {
    const entries: ActionLogEntry[] = [{ t: 6000, type: 'click', selector: '#b', text: 'x' }]

    // A clip trimmed to start at 4s should report this click at 2s in, matching the playhead.
    expect(cleanActionLog(entries, { startSeconds: 4, endSeconds: 8 })[0].atSeconds).toBe(2)
  })

  it('drops ad-tech cookie syncs, which no person ever chose to visit', () => {
    const entries: ActionLogEntry[] = [
      { t: 1000, type: 'navigation', url: 'https://www.eenadu.net/' },
      { t: 9757, type: 'navigation', url: 'https://cpm.vistarsagency.com/user-sync?coppa=&gdpr=0&gdpr_consent=' },
      { t: 9774, type: 'navigation', url: 'https://measureadv.com/userIframe?gdpr=0&gdpr_consent=&p=5' }
    ]

    // Consent parameters mark machinery, not navigation, whatever the host happens to be.
    expect(cleanActionLog(entries, FULL_CLIP).map((a) => a.label)).toEqual(['www.eenadu.net'])
  })

  it('keeps only the first of a burst of navigations', () => {
    const entries: ActionLogEntry[] = [
      { t: 9757, type: 'navigation', url: 'https://first.example/a' },
      { t: 9774, type: 'navigation', url: 'https://second.example/b' },
      { t: 9827, type: 'navigation', url: 'https://third.example/c' },
      { t: 20000, type: 'navigation', url: 'https://later.example/d' }
    ]

    // Nobody visits three sites in 70ms; only the first could have been the user's doing.
    expect(cleanActionLog(entries, FULL_CLIP).map((a) => a.label)).toEqual(['first.example/a', 'later.example/d'])
  })

  it('does not mistake an opaque token for something the user searched for', () => {
    const token = 'EgRM3_t8GOHshdUGIjD2xcWEzXtg-3m6LvTnGo2Qur6tXC757u2oS6c7YRXDsGhuKnYPrAolvjMIATj3X_Yy'
    const entries: ActionLogEntry[] = [
      { t: 0, type: 'navigation', url: `https://www.google.com/sorry/index?continue=x&q=${token}` }
    ]

    expect(cleanActionLog(entries, FULL_CLIP)[0].label).toBe('www.google.com/sorry/index')
  })

  it('survives a malformed url without losing the entry', () => {
    const entries: ActionLogEntry[] = [{ t: 0, type: 'navigation', url: 'not a url' }]

    expect(cleanActionLog(entries, FULL_CLIP)[0].label).toBe('not a url')
  })

  it('returns nothing for an empty log', () => {
    expect(cleanActionLog([], FULL_CLIP)).toEqual([])
  })
})
