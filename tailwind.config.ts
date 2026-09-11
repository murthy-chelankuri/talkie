import type { Config } from 'tailwindcss'

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'system-ui', 'sans-serif'],
        serif: ['Newsreader Variable', 'Georgia', 'serif']
      },
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-hover': 'var(--color-surface-hover)',
        border: 'var(--color-border)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        accent: 'var(--color-accent)',
        'accent-hover': 'var(--color-accent-hover)',
        'accent-foreground': 'var(--color-accent-foreground)',
        danger: 'var(--color-danger)',
        'danger-bg': 'var(--color-danger-bg)',
        success: 'var(--color-success)',
        media: 'var(--color-media)',
        slides: 'var(--color-slides)',
        paper: 'var(--color-paper)',
        'paper-border': 'var(--color-paper-border)'
      }
    }
  },
  plugins: []
} satisfies Config
