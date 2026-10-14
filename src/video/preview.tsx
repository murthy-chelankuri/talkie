import type { ComponentType, CSSProperties } from 'react'
import { chooseOwnRenderer } from './engine'
import { OwnPreview } from './own/player'

/**
 * The editor's player: the stage, the HTML scene panel and the theme preview. Talkie's own player
 * (own/player.tsx) draws the composition on Talkie's own clock; this file is the handle, the events
 * and the props the transport bar, the timeline, the script and the three hosts use — the same ones
 * they used when Remotion's `<Player>` was behind them, so none of them changed when it was replaced.
 */

// The editor draws every scene with Talkie's own renderer, as the export page does; chosen here,
// once, before any scene renders (engine.ts).
chooseOwnRenderer()

export type PreviewEvents = { frameupdate: { frame: number }; play: undefined; pause: undefined }
type Listener<E extends keyof PreviewEvents> = (event: { detail: PreviewEvents[E] }) => void

export interface PreviewHandle {
  seekTo(frame: number): void
  getCurrentFrame(): number
  toggle(): void
  isPlaying(): boolean
  mute(): void
  unmute(): void
  isMuted(): boolean
  requestFullscreen(): void
  addEventListener<E extends keyof PreviewEvents>(event: E, listener: Listener<E>): void
  removeEventListener<E extends keyof PreviewEvents>(event: E, listener: Listener<E>): void
}

export type PreviewProps<P extends object> = {
  component: ComponentType<P>
  inputProps: P
  durationInFrames: number
  fps: number
  /**
   * The composition's size, not the element's. The picture is drawn at this size and scaled to
   * fit `style`; scenes rely on that (fixed pixel font sizes, HtmlScene's 1920-wide frame).
   */
  width: number
  height: number
  /** The player's own controls, for panels without the editor's transport bar. */
  controls?: boolean
  loop?: boolean
  autoPlay?: boolean
  style?: CSSProperties
}

export const Preview = OwnPreview
