import { useCallback, useEffect, useState } from 'react'

export type RailPanelId = 'project' | 'add' | 'voice' | 'agent'
export const RAIL_ORDER: RailPanelId[] = ['project', 'add', 'voice', 'agent']

const KEY = 'talkie.railPanel'

function stored(): RailPanelId | null {
  try {
    const value = localStorage.getItem(KEY)
    return RAIL_ORDER.includes(value as RailPanelId) ? (value as RailPanelId) : null
  } catch {
    return null
  }
}

/**
 * Which of the editor's side panels is open — at most one — remembered on this Mac like the
 * theme. ⌘1–⌘4 open them in rail order; Esc shuts the open one, unless it belongs to something
 * else: a field being typed in, or a dialog that is open.
 */
export function useRailPanel(): {
  open: RailPanelId | null
  toggle: (id: RailPanelId) => void
  /** Open this one whatever is open now — for when the editor has something to show in it. */
  show: (id: RailPanelId) => void
  close: () => void
} {
  const [open, setOpen] = useState<RailPanelId | null>(stored)

  useEffect(() => {
    try {
      if (open) localStorage.setItem(KEY, open)
      else localStorage.removeItem(KEY)
    } catch {
      // Remembering which panel was open is a convenience; not being able to is no failure.
    }
  }, [open])

  const toggle = useCallback((id: RailPanelId) => setOpen((current) => (current === id ? null : id)), [])
  const show = useCallback((id: RailPanelId) => setOpen(id), [])
  const close = useCallback(() => setOpen(null), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && /^[1-4]$/.test(event.key)) {
        event.preventDefault()
        toggle(RAIL_ORDER[Number(event.key) - 1])
        return
      }
      // A list or menu inside a panel that took the Esc for itself closes alone, not with its panel.
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const active = document.activeElement as HTMLElement | null
      const typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)
      if (typing || document.querySelector('[role="dialog"]')) return
      setOpen(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return { open, toggle, show, close }
}
