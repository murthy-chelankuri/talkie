import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { IconButton } from './ui/IconButton'

export function AppShell({
  children,
  breadcrumb
}: {
  children: ReactNode
  /** Rendered next to the wordmark — the project switcher, when a project is open. */
  breadcrumb?: ReactNode
}): JSX.Element {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-2">
        <span className="flex items-center gap-2">
          {/* An aperture-like mark: the app's one piece of identity, drawn rather than an icon
              borrowed from the set used for controls. */}
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-[7px] bg-accent text-accent-foreground"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          </span>
          <span className="font-serif text-[15px] leading-none text-text">Talkie</span>
          {breadcrumb && (
            <>
              <span aria-hidden="true" className="px-0.5 text-text-muted">
                /
              </span>
              {breadcrumb}
            </>
          )}
        </span>
        <IconButton
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
