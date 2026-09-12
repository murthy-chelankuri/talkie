import type { SceneStyle } from '../main/project/timeline/schema'

/**
 * The looks a scene can take, defined once so the editor's preview and the exported video are
 * drawn from the same numbers rather than from two sets that drift apart.
 */
export interface ResolvedSceneTheme {
  background: string
  heading: string
  body: string
  accent: string
  headingFont: string
  bodyFont: string
  align: 'left' | 'center'
  headingSize: number
  bodySize: number
}

const SERIF = 'Newsreader Variable, ui-serif, Georgia, serif'
const SANS = 'Geist Variable, ui-sans-serif, system-ui, sans-serif'

const THEMES = {
  graphite: {
    background: 'linear-gradient(160deg, #232833 0%, #171b22 55%, #101318 100%)',
    heading: '#f4f6f9',
    body: '#c9cedb'
  },
  ink: {
    background: 'linear-gradient(160deg, #14171d 0%, #0b0d11 100%)',
    heading: '#ffffff',
    body: '#a7afbe'
  },
  paper: {
    background: 'linear-gradient(160deg, #fdfbf6 0%, #f2ede2 100%)',
    heading: '#1c1a16',
    body: '#514b41'
  },
  brass: {
    background: 'linear-gradient(160deg, #3a2c10 0%, #23190a 100%)',
    heading: '#fbf3e2',
    body: '#e0cfa8'
  }
} as const

export function resolveSceneTheme(style: SceneStyle | undefined): ResolvedSceneTheme {
  const theme = THEMES[style?.theme ?? 'graphite'] ?? THEMES.graphite
  const large = style?.size === 'large'

  return {
    ...theme,
    accent: style?.accent || '#d3a24c',
    headingFont: style?.font === 'sans' ? SANS : SERIF,
    bodyFont: SANS,
    align: style?.align ?? 'left',
    headingSize: large ? 116 : 92,
    bodySize: large ? 56 : 46
  }
}
