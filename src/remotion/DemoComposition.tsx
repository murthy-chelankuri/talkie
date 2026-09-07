import { Sequence } from 'remotion'
import type { TimelineItem } from './types'
import { ITEM_REGISTRY } from './itemRegistry'

export function DemoComposition({ timeline }: { timeline: TimelineItem[] }): JSX.Element {
  return (
    <>
      {timeline.map((item) => {
        const Component = ITEM_REGISTRY[item.kind]
        if (!Component) return null
        return (
          <Sequence key={item.id} from={item.start} durationInFrames={item.duration}>
            <Component data={item.data} />
          </Sequence>
        )
      })}
    </>
  )
}
