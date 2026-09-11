import { Audio, Sequence } from 'remotion'
import type { TimelineItem } from './types'
import { ITEM_REGISTRY } from './itemRegistry'
import { NARRATION_LEAD_IN_FRAMES } from './constants'

export function DemoComposition({ timeline }: { timeline: TimelineItem[] }): JSX.Element {
  return (
    <>
      {timeline.map((item) => {
        const Component = ITEM_REGISTRY[item.kind]
        if (!Component) return null
        // Narration is attached to `data.audioUrl` at read/render time (resolveTimelineAssetUrls),
        // not persisted on the timeline item itself — see readNarrationAudioPaths in projectApi.ts.
        const audioUrl = (item.data as { audioUrl?: string } | null | undefined)?.audioUrl
        return (
          <Sequence key={item.id} from={item.start} durationInFrames={item.duration}>
            <Component data={item.data} />
            {/* Held back a beat so the clip is seen before it is spoken over. Nested Sequence
                offsets are relative to the clip, so this is a delay within it. */}
            {audioUrl && (
              <Sequence from={NARRATION_LEAD_IN_FRAMES}>
                <Audio src={audioUrl} />
              </Sequence>
            )}
          </Sequence>
        )
      })}
    </>
  )
}
