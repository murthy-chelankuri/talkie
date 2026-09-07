import type { TimelineItem } from './types'

export function computeTimelineDuration(timeline: TimelineItem[]): number {
  if (timeline.length === 0) return 1
  return Math.max(...timeline.map((item) => item.start + item.duration))
}
