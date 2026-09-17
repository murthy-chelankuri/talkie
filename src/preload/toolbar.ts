import { contextBridge, ipcRenderer } from 'electron'

/**
 * The recording toolbar's whole reach into the app.
 *
 * This window used to run with node integration on and context isolation off, which handed a
 * small always-on-top window the entire Node runtime — `require('fs')`, `child_process`, the lot —
 * to press four buttons with. What it actually needs is these few calls, so these are the only
 * ones it gets.
 */
const captureApi = {
  start: (projectId: string, url: string, explore = false): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke('project:capture:start', projectId, url, explore),
  /** What the automatic walk is doing, when the user asked for one. One way, main to here. */
  onExploring: (callback: (status: string, needsYou: boolean) => void): (() => void) => {
    const listener = (_event: unknown, status: string, needsYou: boolean): void =>
      callback(status, needsYou)
    ipcRenderer.on('project:capture:exploring', listener)
    return () => ipcRenderer.removeListener('project:capture:exploring', listener)
  },
  mark: (kind: 'important' | 'redo' | 'skip'): Promise<void> =>
    ipcRenderer.invoke('project:capture:mark', kind),
  stop: (): Promise<void> => ipcRenderer.invoke('project:capture:stop'),
  close: (): void => window.close()
}

contextBridge.exposeInMainWorld('capture', captureApi)

export type CaptureToolbarApi = typeof captureApi
