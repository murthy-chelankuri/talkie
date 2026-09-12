import type { IpcMain, BrowserWindow } from 'electron'
import { dialog } from 'electron'
import { homedir } from 'os'
import {
  readTimelineLenient,
  addTimelineItem,
  importImage,
  reorderTimelineItems,
  readNarrationAudioPaths,
  splitTimelineItem,
  deleteTimelineItem
} from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { withHistory } from '../project/history'
import { prepareDeck, saveSlides, type PreparedDeck } from '../slides/importSlides'
import { describeExport, openExport, showExportInFinder } from '../render/revealExport'
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
    const narrationAudioPaths = readNarrationAudioPaths(id)
    return resolveTimelineAssetUrls(timeline, rootDir, assetServer.url, narrationAudioPaths)
  })

  ipcMain.handle(
    'project:timeline:addItem',
    (_event, id: string, item: { kind: string; start: number; duration: number; data: unknown }) =>
      withHistory(id, () => addTimelineItem(id, item))
  )

  ipcMain.handle('project:timeline:reorder', (_event, id: string, orderedIds: string[]) =>
    withHistory(id, () => reorderTimelineItems(id, orderedIds))
  )

  ipcMain.handle('project:timeline:split', (_event, id: string, timelineItemId: string, atFrame: number) =>
    withHistory(id, () => splitTimelineItem(id, timelineItemId, atFrame))
  )

  ipcMain.handle('project:timeline:delete', (_event, id: string, timelineItemId: string) =>
    withHistory(id, () => deleteTimelineItem(id, timelineItemId))
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

    return withHistory(id, () => importImage(id, result.filePaths[0]))
  })

  ipcMain.handle('project:render:describe', (_event, path: string) => describeExport(path))
  ipcMain.handle('project:render:open', (_event, path: string) => openExport(path))
  ipcMain.handle('project:render:reveal', (_event, path: string) => showExportInFinder(path))

  ipcMain.handle('project:import:deck', async (_event, _id: string) => {
    const window = getWindow()
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'Presentations', extensions: ['pptx', 'pdf'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) {
      return { status: 'cancelled' } satisfies PreparedDeck
    }

    return prepareDeck(result.filePaths[0])
  })

  // Rasterising happens in the renderer, where a canvas exists, so the pages come back here.
  ipcMain.handle(
    'project:import:saveSlides',
    (_event, id: string, pages: Array<{ png: Uint8Array }>, notes: string[]) =>
      withHistory(id, () => saveSlides(id, pages, notes))
  )
}
