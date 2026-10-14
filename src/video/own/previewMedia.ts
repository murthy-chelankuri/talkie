import { createContext, useContext } from 'react'

/**
 * How a preview's <video> and <audio> reach the player that keeps them in step (player.tsx). Its
 * own module so the media components can use it without importing the player: the export page
 * draws the same components and carries no player.
 */

/** A `<video>` or `<audio>` the composition mounted, for the player to keep in step with the clock. */
export type PreviewMediaEntry = {
  el: HTMLMediaElement
  kind: 'video' | 'audio'
  /** Absolute composition frames: where the clip begins and ends. */
  startFrame: number
  endFrame: number
  /** Frames into the file the clip starts at (a recording's lead-in; 0 for narration). */
  trimBefore: number
}

export type RegisterPreviewMedia = (entry: PreviewMediaEntry) => () => void

export const PreviewMediaContext = createContext<RegisterPreviewMedia | null>(null)

/** How media registers with the player. A no-op off the player, so a stray render cannot throw. */
export function usePreviewMediaRegister(): RegisterPreviewMedia {
  return useContext(PreviewMediaContext) ?? (() => () => undefined)
}
