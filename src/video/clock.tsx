import type { CSSProperties, ReactNode } from 'react'
import {
  AbsoluteFill,
  Sequence as RemotionSequence,
  getRemotionEnvironment,
  useCurrentFrame,
  useVideoConfig as useRemotionVideoConfig
} from 'remotion'

/**
 * The frame clock the composition is drawn against. The host (the editor's preview or the
 * export) owns the frame; scenes only read it.
 *
 * Delegates to Remotion until steps 3 and 4 of the renderer replace it; the names here are the
 * ones the scenes keep.
 */

export type VideoConfig = { fps: number; width: number; height: number; durationInFrames: number }
export type RenderMode = 'export' | 'preview'

/** The frame, counted from the start of the nearest enclosing Sequence. */
export function useFrame(): number {
  return useCurrentFrame()
}

/**
 * The video's size and rate, and the enclosing Sequence's length. That length is clipped to the
 * parent Sequence's, as Remotion's is, so a nested Sequence never reports more than remains.
 */
export function useVideoConfig(): VideoConfig {
  const { fps, width, height, durationInFrames } = useRemotionVideoConfig()
  return { fps, width, height, durationInFrames }
}

/** Whether frames are being exported, which waits on holds, or previewed, which never does. */
export function useRenderMode(): RenderMode {
  return getRemotionEnvironment().isRendering ? 'export' : 'preview'
}

/**
 * Shifts the clock for its children, and mounts them only while the frame is inside it.
 *
 * The children sit in one full-frame layer laid out as `Fill` is, which `ImageItem` and
 * `VideoItem` rely on to size themselves at 100%. A nested Sequence ends no later than its
 * parent, whatever duration it asks for: a narration take that runs past its clip is cut there.
 */
export function Sequence({ from, durationInFrames, children }: { from: number; durationInFrames?: number; children: ReactNode }): JSX.Element {
  return (
    <RemotionSequence from={from} durationInFrames={durationInFrames}>
      {children}
    </RemotionSequence>
  )
}

/**
 * A layer covering the whole frame, as a flex column: absolutely positioned, top/left/right/bottom
 * 0, width and height 100%, `display: flex`, `flex-direction: column`. A slide centres itself
 * with `justifyContent`/`alignItems` on this and would sit in the corner without the column.
 * The caller's `style` is applied over that layout. `clock.test.tsx` holds it.
 */
export function Fill({ style, children }: { style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>
}
