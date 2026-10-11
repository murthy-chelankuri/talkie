/**
 * The project last opened in this window, so the home screen can lead with it. Remembered on this
 * Mac like the theme: projects record when they were made, not when they were last worked on.
 */
const KEY = 'talkie.lastProject'

export function rememberLastProject(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Not remembering means the home screen leads with the newest project instead.
  }
}

export function lastProjectId(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
