import { useEffect, useState } from 'react'

/**
 * The script on its own, the whole window high.
 *
 * Under the stage it gets a third of the window, which shows a scene and a half — not enough to
 * read narration in context, the one thing the script is for. Only the script can have the
 * window: the timeline is for arranging against the picture, so it is never without the stage.
 * Esc gives the video back, unless a dialog is open and the Esc is that dialog's.
 */
export function useScriptFocus(scriptShown: boolean): { focused: boolean; toggle: () => void; leave: () => void } {
  const [on, setOn] = useState(false)
  const focused = on && scriptShown

  useEffect(() => {
    if (!focused) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      setOn(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focused])

  return { focused, toggle: () => setOn((value) => !value), leave: () => setOn(false) }
}
