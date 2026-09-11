type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Settings are edited in a dialog the shell owns, but they change what the editor shows — a
 * different voice makes existing narration stale. This lets the two talk without threading
 * settings state through every screen between them.
 */
export function onSettingsChanged(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifySettingsChanged(): void {
  for (const listener of listeners) listener()
}
