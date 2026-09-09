import type { IpcMain, BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { homedir } from 'os'
import { readTimelineLenient, addTimelineItem, importImage, reorderTimelineItems } from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { renderProjectVideo } from '../render/renderProject'
import { getAssetServer, resolveTimelineAssetUrls } from '../render/assetServer'
import type { TimelineItem as RemotionTimelineItem } from '../../remotion/types'

export function registerTimelineHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('project:timeline:read', async (_event, id: string) => {
    // Cast: project/timeline/schema.ts's zod-inferred TimelineItem treats `data` as optional
    // (z.unknown() accepts undefined), while remotion/types.ts's hand-written TimelineItem
    // requires it. Both describe the same real shape validated by TimelineItemSchema.superRefine,
    // so the optionality is a static-typing artifact, not a runtime possibility. Same workaround
    // as renderProject.ts.
    const timeline = readTimelineLenient(id) as unknown as RemotionTimelineItem[]
    const rootDir = projectsRootDir(homedir())
    const assetServer = await getAssetServer(rootDir)
    return resolveTimelineAssetUrls(timeline, rootDir, assetServer.url)
  })

  ipcMain.handle(
    'project:timeline:addItem',
    (_event, id: string, item: { kind: string; start: number; duration: number; data: unknown }) =>
      addTimelineItem(id, item)
  )

  ipcMain.handle('project:timeline:reorder', (_event, id: string, orderedIds: string[]) =>
    reorderTimelineItems(id, orderedIds)
  )

  ipcMain.handle('project:render:export', (_event, id: string) => renderProjectVideo(id))

  ipcMain.handle('project:import:image', async (_event, id: string) => {
    const window = getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return importImage(id, result.filePaths[0])
  })
}
