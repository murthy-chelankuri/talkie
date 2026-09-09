import { Audio, Sequence } from 'remotion'
import type { TimelineItem } from './types'
import { ITEM_REGISTRY } from './itemRegistry'

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
            {audioUrl && <Audio src={audioUrl} />}
          </Sequence>
        )
      })}
    </>
  )
}
