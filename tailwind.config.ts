import type { Config } from 'tailwindcss'

/**
 * A token Tailwind can take an opacity off, as in `ring-accent/35`.
 *
 * A bare `var()` gives Tailwind nothing to put the alpha into, so it dropped every such class
 * without a word — the soft buttons lost their outline and every tinted hover was transparent.
 * `color-mix` puts it back without asking the tokens to be written as channels.
 */
const token = (name: string): string => `color-mix(in srgb, var(--color-${name}) calc(<alpha-value> * 100%), transparent)`

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/renderer/index.html',
    // The recording toolbar is a plain page rather than a React screen, but it is the same
    // product and must not drift into its own look.
    './src/renderer/toolbar.html',
    './src/renderer/toolbar.ts',
    './src/renderer/src/**/*.{ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'system-ui', 'sans-serif'],
        serif: ['Newsreader Variable', 'Georgia', 'serif']
      },
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        raised: token('raised'),
        'surface-hover': token('surface-hover'),
        border: token('border'),
        text: token('text'),
        'text-muted': token('text-muted'),
        accent: token('accent'),
        // The accent's two other forms: filled for what is acted on, and a tint for AI actions.
        'accent-fill': token('accent-fill'),
        'accent-soft': token('accent-soft'),
        'accent-hover': token('accent-hover'),
        'accent-foreground': token('accent-foreground'),
        danger: token('danger'),
        'danger-bg': token('danger-bg'),
        success: token('success'),
        media: token('media'),
        slides: token('slides'),
        paper: token('paper'),
        'paper-text': token('paper-text'),
        'on-accent': token('on-accent'),
        'paper-border': token('paper-border'),
        warning: token('warning')
      }
    }
  },
  plugins: []
} satisfies Config
