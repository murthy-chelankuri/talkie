import { useEffect } from 'react'
import type { MenuAction } from '../../../main/menu/applicationMenu'

export type { MenuAction }

/**
 * Runs a handler when the menu asks for something.
 *
 * The menu names an action and the window decides what it means, so a screen only subscribes to
 * what it can actually do — the editor knows how to export, the shell knows how to open settings,
 * and neither has to know about the other. Anything with no listener on screen simply does
 * nothing, which is the same as the menu item being unavailable.
 */
export function useMenuActions(handlers: Partial<Record<MenuAction, () => void>>): void {
  useEffect(() => {
    // Absent wherever the preload bridge is not there — a test rendering a component on its own,
    // or a window that failed to load it. A menu that cannot reach the window is not a crash.
    const menu = window.api?.menu
    if (!menu) return

    return menu.onAction((action) => {
      handlers[action]?.()
    })
    // Handlers are rebuilt each render; re-subscribing keeps them from closing over stale state.
  })
}

/**
 * Tells the menu what is on screen.
 *
 * An item's enabled flag is fixed when the menu is built, so the menu has to be told rather than
 * asked — an Export item that stays available on the project list is worse than none at all.
 */
export function useMenuState(state: { projectOpen?: boolean; canUndo?: boolean; canRedo?: boolean }): void {
  const { projectOpen, canUndo, canRedo } = state

  useEffect(() => {
    void window.api?.menu?.setState({ projectOpen, canUndo, canRedo })
  }, [projectOpen, canUndo, canRedo])
}
