/**
 * The messages between a scene's page and whatever is playing it — the composition in the preview
 * and the export, or the headless host the check uses. Plain data: both sides are sandboxed from
 * each other and talk only through postMessage.
 */
/** The colours of the scene's look, its fonts as data URLs, and its logo — see toRenderTheme.ts. */
export interface SceneTheme {
  background: string
  heading: string
  body: string
  accent: string
  fonts: { heading: { family: string; urls: string[] }; body: { family: string; urls: string[] } }
  logo?: string
}

export interface InitMessage {
  type: 'talkie:init'
  fps: number
  durationFrames: number
  width: number
  height: number
  params: Record<string, unknown>
  theme: SceneTheme | null
  /** Seconds into the scene at which each line of its narration starts. */
  beats: number[]
}

export interface SeekMessage {
  type: 'talkie:seek'
  frame: number
  id: number
}

export interface ThemeMessage {
  type: 'talkie:theme'
  theme: SceneTheme | null
}

export type HostMessage = InitMessage | SeekMessage | ThemeMessage
export type SceneMessage =
  | { type: 'talkie:ready' }
  | { type: 'talkie:drawn'; id: number }
  | { type: 'talkie:error'; message: string; line?: number }

/** A frame not drawn by then is captured anyway, so one broken scene cannot hang an export. */
export const DRAW_TIMEOUT_MS = 5000

export function isSceneMessage(value: unknown): value is SceneMessage {
  const type = (value as { type?: unknown } | null)?.type
  return type === 'talkie:ready' || type === 'talkie:drawn' || type === 'talkie:error'
}
