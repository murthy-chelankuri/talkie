const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const THIRTY_DAYS = 30 * DAY

export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then

  if (diff < MINUTE) return 'just now'

  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }

  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }

  if (diff < THIRTY_DAYS) {
    const days = Math.floor(diff / DAY)
    return `${days} day${days === 1 ? '' : 's'} ago`
  }

  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
