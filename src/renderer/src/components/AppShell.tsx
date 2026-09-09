import type { ReactNode } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { IconButton } from './ui/IconButton'

export function AppShell({ children }: { children: ReactNode }): JSX.Element {
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="flex h-screen flex-col bg-bg text-text">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-semibold">Demo Editor</span>
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
