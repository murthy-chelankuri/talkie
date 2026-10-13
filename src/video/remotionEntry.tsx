import { registerRoot, Composition } from 'remotion'
import { DemoComposition } from '../remotion/DemoComposition'
import { FPS, WIDTH, HEIGHT, COMPOSITION_ID } from '../remotion/constants'

/**
 * The entry Remotion's bundler builds the composition from, for export.
 *
 * Here rather than beside the scenes because it is Remotion's and nothing else's. Step 3 of the
 * renderer replaces it with Talkie's own export page.
 */
function RemotionRoot(): JSX.Element {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={DemoComposition}
      durationInFrames={150}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ timeline: [], theme: null }}
    />
  )
}

registerRoot(RemotionRoot)
