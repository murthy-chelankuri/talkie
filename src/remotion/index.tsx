import { registerRoot, Composition } from 'remotion'
import { DemoComposition } from './DemoComposition'
import { FPS, WIDTH, HEIGHT } from './constants'

export const COMPOSITION_ID = 'Demo'

function RemotionRoot(): JSX.Element {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={DemoComposition}
      durationInFrames={150}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ timeline: [] }}
    />
  )
}

registerRoot(RemotionRoot)
