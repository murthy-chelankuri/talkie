import { describe, expect, it } from 'vitest'
import { Sequence } from 'remotion'
import { DemoComposition } from './DemoComposition'
import { NARRATION_LEAD_IN_FRAMES } from './constants'
import type { TimelineItem } from './types'

/**
 * Remotion components need a player context to render, so rather than rendering this asserts on
 * the element tree the composition builds — which is where the audio offset lives.
 */
function audioSequenceFor(item: TimelineItem): Record<string, unknown> | null {
  // The clips sit inside the theme's provider, after the slot its fonts would take.
  const tree = DemoComposition({ timeline: [item] }) as unknown as {
    props: { children: [unknown, Array<{ props: { children: unknown[] } }>] }
  }
  const clip = tree.props.children[1][0]
  const audioWrapper = clip.props.children.find(
    (child) => (child as { type?: unknown })?.type === Sequence
  ) as { props: Record<string, unknown> } | undefined
  return audioWrapper?.props ?? null
}

const withAudio: TimelineItem = {
  id: 'a',
  kind: 'image',
  start: 0,
  duration: 120,
  data: { src: 'http://x/a.png', audioUrl: 'http://x/a.wav' }
} as TimelineItem

describe('DemoComposition narration timing', () => {
  it('holds the narration back so the clip is seen before it is spoken over', () => {
    expect(audioSequenceFor(withAudio)?.from).toBe(NARRATION_LEAD_IN_FRAMES)
  })

  it('waits a real fraction of a second, not a single frame', () => {
    expect(NARRATION_LEAD_IN_FRAMES).toBeGreaterThanOrEqual(10)
  })

  it('adds no audio sequence to a clip that has no narration', () => {
    const silent = { ...withAudio, data: { src: 'http://x/a.png' } } as TimelineItem

    expect(audioSequenceFor(silent)).toBeNull()
  })
})
