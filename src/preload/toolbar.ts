import { contextBridge, ipcRenderer } from 'electron'

/**
 * The recording toolbar's whole reach into the app.
 *
 * This window used to run with node integration on and context isolation off, which handed a
 * small always-on-top window the entire Node runtime — `require('fs')`, `child_process`, the lot —
 * to press four buttons with. What it actually needs is these five calls, so these are the only
 * five it gets.
 */
const captureApi = {
  start: (projectId: string, url: string): Promise<{ sessionId: string }> =>
    ipcRenderer.invoke('project:capture:start', projectId, url),
  mark: (kind: 'important' | 'redo' | 'skip'): Promise<void> =>
    ipcRenderer.invoke('project:capture:mark', kind),
  stop: (): Promise<void> => ipcRenderer.invoke('project:capture:stop'),
  close: (): void => window.close()
}

contextBridge.exposeInMainWorld('capture', captureApi)

export type CaptureToolbarApi = typeof captureApi
