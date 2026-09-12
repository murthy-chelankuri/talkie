import { useState, type ReactNode } from 'react'
import { Moon, Settings as SettingsIcon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { IconButton } from './ui/IconButton'
import { SettingsDialog } from './SettingsDialog'

export function AppShell({
  children,
  breadcrumb
}: {
  children: ReactNode
  /** Rendered next to the wordmark — the project switcher, when a project is open. */
  breadcrumb?: ReactNode
}): JSX.Element {
  const { theme, toggleTheme } = useTheme()
  const [showSettings, setShowSettings] = useState(false)

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
            {/* The app icon's own mark, so the thing in the dock and the thing in the corner are
                recognisably the same. A dot was left over from the icon before it. */}
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor">
              <rect x="5.4" y="7" width="2.4" height="6" rx="1.2" />
              <rect x="9.1" y="4.5" width="2.4" height="11" rx="1.2" />
              <rect x="12.8" y="6" width="2.4" height="8" rx="1.2" />
            </svg>
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
        <span className="flex items-center gap-1">
          <IconButton aria-label="Settings" onClick={() => setShowSettings(true)}>
            <SettingsIcon size={16} />
          </IconButton>
          <IconButton
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}
