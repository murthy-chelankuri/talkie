import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from './formatRelativeTime'

const NOW = new Date('2026-09-09T12:00:00.000Z')

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for timestamps under a minute old', () => {
    const iso = new Date(NOW.getTime() - 30 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('just now')
  })

  it('returns singular "1 minute ago"', () => {
    const iso = new Date(NOW.getTime() - 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('1 minute ago')
  })

  it('returns plural minutes', () => {
    const iso = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('5 minutes ago')
  })

  it('returns singular "1 hour ago"', () => {
    const iso = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('1 hour ago')
  })

  it('returns plural hours', () => {
    const iso = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('3 hours ago')
  })

  it('returns singular "1 day ago"', () => {
    const iso = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('1 day ago')
  })

  it('returns plural days', () => {
    const iso = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('2 days ago')
  })

  it('falls back to a formatted date past 30 days', () => {
    const iso = new Date(NOW.getTime() - 45 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeTime(iso)).toBe('Jul 26, 2026')
  })
})
