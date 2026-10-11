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

/** Talkie's own two families, which every scene can load from the runtime's own server. */
export const TALKIE_FONT_FILES: Record<string, string> = {
  'Geist Variable': 'fonts/geist.woff2',
  'Newsreader Variable': 'fonts/newsreader.woff2'
}

/**
 * The look a scene gets in a project with no theme: the palettes slides have always had, so a scene
 * written against the variables looks like the rest of an unthemed video, not like no look at all.
 */
const TALKIE_FONTS = { heading: { family: 'Newsreader Variable', urls: [] }, body: { family: 'Geist Variable', urls: [] } }
export const DEFAULT_SCENE_THEMES: Record<'brand' | 'light' | 'dark', SceneTheme> = {
  dark: { background: '#171b22', heading: '#f4f6f9', body: '#c9cedb', accent: '#7ab5f0', fonts: TALKIE_FONTS },
  light: { background: '#f7f3ea', heading: '#1c1a16', body: '#514b41', accent: '#1a5fb4', fonts: TALKIE_FONTS },
  brand: { background: '#2e2310', heading: '#fbf3e2', body: '#e0cfa8', accent: '#e9b949', fonts: TALKIE_FONTS }
}

/** A frame not drawn by then is captured anyway, so one broken scene cannot hang an export. */
export const DRAW_TIMEOUT_MS = 5000

export function isSceneMessage(value: unknown): value is SceneMessage {
  const type = (value as { type?: unknown } | null)?.type
  return type === 'talkie:ready' || type === 'talkie:drawn' || type === 'talkie:error'
}
