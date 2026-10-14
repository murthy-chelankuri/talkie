import type { CSSProperties, ReactNode } from 'react'
import { OwnFill, OwnSequence, useOwnFrame, useOwnRenderMode, useOwnVideoConfig } from './own/clock'

/**
 * The frame clock the composition is drawn against. The host (the editor's preview or the
 * export page) owns the frame; scenes only read it. The names are the ones the scenes were written
 * against when Remotion drew them, and the behaviour behind each is held to what Remotion's was.
 */

export type VideoConfig = { fps: number; width: number; height: number; durationInFrames: number }
export type RenderMode = 'export' | 'preview'

/** The frame, counted from the start of the nearest enclosing Sequence. */
export function useFrame(): number {
  return useOwnFrame()
}

/**
 * The video's size and rate, and the enclosing Sequence's length. That length is clipped to the
 * parent Sequence's, so a nested Sequence never reports more than remains.
 */
export function useVideoConfig(): VideoConfig {
  return useOwnVideoConfig()
}

/** Whether frames are being exported, which waits on holds, or previewed, which never does. */
export function useRenderMode(): RenderMode {
  return useOwnRenderMode()
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
    <OwnSequence from={from} durationInFrames={durationInFrames}>
      {children}
    </OwnSequence>
  )
}

/**
 * A layer covering the whole frame, as a flex column: absolutely positioned, top/left/right/bottom
 * 0, width and height 100%, `display: flex`, `flex-direction: column`. A slide centres itself
 * with `justifyContent`/`alignItems` on this and would sit in the corner without the column.
 * The caller's `style` is applied over that layout. `clock.test.tsx` holds it.
 */
export function Fill({ style, children }: { style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return <OwnFill style={style}>{children}</OwnFill>
}
