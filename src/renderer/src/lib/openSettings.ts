export type SettingsSection = 'narration' | 'themes' | 'recording' | 'export' | 'system' | 'licences'

type Listener = (section: SettingsSection) => void

const listeners = new Set<Listener>()

/**
 * Settings belong to the shell, but what is wrong is usually found somewhere else — the agent
 * panel knowing that no provider can run it. This opens them at the section that puts it right,
 * rather than leaving a message that says where to go.
 */
export function onSettingsRequested(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function openSettings(section: SettingsSection): void {
  for (const listener of listeners) listener(section)
}
