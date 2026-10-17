/** What the window is told when the open project changed on disk under it (projectWatchHandlers.ts). */
export interface DiskChange {
  /**
   * Undo was emptied. Undo puts back whole files as they were before the app's last change, so
   * after an outside agent's work it would silently throw that work away along with the step.
   */
  historyCleared: boolean
}
