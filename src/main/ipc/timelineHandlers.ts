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
import { readTranscript } from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import {
  chooseVersion,
  createVersion,
  deleteVersion,
  readVersions,
  renameVersion,
  setClipIncluded
} from '../project/versionsStore'
import { beatsByItem } from '../transcript/captions'
import { withHistory } from '../project/history'
import { prepareDeck, saveSlides, type PreparedDeck, type SlidePage } from '../slides/importSlides'
import type { SlideText } from '../slides/slideText'
import { describeExport, openExport, showExportInFinder } from '../render/revealExport'
import { addScene, updateSceneData, writeDiagramSvg } from '../project/projectApi'
import { writeScene, type SceneRequest } from '../agent/writeScene'
import { renderProjectVideo } from '../render/renderProject'
import { cancelExport, runExport } from '../render/exportJob'
import { getAssetServer, resolveTimelineAssetUrls } from '../render/assetServer'
import { burnedCaptionsFor } from '../transcript/burnedCaptions'
import type { TimelineItem as CompositionTimelineItem } from '../../composition/types'

/**
 * The timeline as the window needs it: every file it plays — recordings, pictures, diagrams, pages,
 * takes — as an asset-server address, since the window cannot load the files themselves.
 *
 * Every handler that hands the window a timeline goes through this. Reordering once returned the
 * timeline as it is on disk instead, and the editor showed it: after a drag, every recording,
 * picture and HTML scene in the preview pointed at a bare file path and stayed blank, while the
 * slides between them — which have no media — drew as before.
 */
async function timelineForWindow(id: string): Promise<CompositionTimelineItem[]> {
  // Cast: project/timeline/schema.ts's zod-inferred TimelineItem treats `data` as optional
  // (z.unknown() accepts undefined), while composition/types.ts's hand-written TimelineItem
  // requires it. Both describe the same real shape validated by TimelineItemSchema.superRefine,
  // so the optionality is a static-typing artifact, not a runtime possibility. Same workaround
  // as renderProject.ts.
  const timeline = readTimelineLenient(id) as unknown as CompositionTimelineItem[]
  const rootDir = projectsRootDir(homedir())
  const assetServer = await getAssetServer(rootDir)
  const narrationAudioPaths = readNarrationAudioPaths(id)
  return resolveTimelineAssetUrls(
    timeline,
    rootDir,
    assetServer.url,
    narrationAudioPaths,
    burnedCaptionsFor(id),
    beatsByItem(readTranscript(id))
  )
}

export function registerTimelineHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('project:timeline:read', (_event, id: string) => timelineForWindow(id))

  ipcMain.handle(
    'project:timeline:addItem',
    (_event, id: string, item: { kind: string; start: number; duration: number; data: unknown }) =>
      withHistory(id, () => addTimelineItem(id, item))
  )

  ipcMain.handle('project:timeline:reorder', (_event, id: string, orderedIds: string[]) => {
    withHistory(id, () => reorderTimelineItems(id, orderedIds))
    return timelineForWindow(id)
  })

  ipcMain.handle('project:timeline:split', (_event, id: string, timelineItemId: string, atFrame: number) => {
    withHistory(id, () => splitTimelineItem(id, timelineItemId, atFrame))
    return timelineForWindow(id)
  })

  ipcMain.handle('project:timeline:delete', (_event, id: string, timelineItemId: string) => {
    withHistory(id, () => deleteTimelineItem(id, timelineItemId))
    return timelineForWindow(id)
  })

  // Progress goes back to the window that asked, as it happens: an export takes minutes, and a
  // button that only says it is busy cannot tell anyone whether it is slow or stuck.
  ipcMain.handle('project:render:export', (event, id: string) =>
    runExport(
      id,
      (projectId, options) => renderProjectVideo(projectId, homedir(), options),
      (progress) => {
        if (!event.sender.isDestroyed()) event.sender.send('project:render:progress', id, progress)
      }
    )
  )
  ipcMain.handle('project:render:cancel', (_event, id: string) => cancelExport(id))

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

  ipcMain.handle('project:scene:add', (_event, id: string, kind: 'scene' | 'diagram', data: unknown) =>
    withHistory(id, () => addScene(id, kind, data))
  )
  ipcMain.handle('project:scene:update', (_event, id: string, itemId: string, data: unknown) =>
    withHistory(id, () => updateSceneData(id, itemId, data))
  )
  // The SVG is drawn in the renderer, where mermaid lives, and stored here beside the project.
  ipcMain.handle('project:scene:saveSvg', (_event, id: string, svg: string) => writeDiagramSvg(id, svg))
  ipcMain.handle('project:scene:write', (_event, request: SceneRequest) => writeScene(request))

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
    (_event, id: string, pages: SlidePage[], notes: string[], texts: SlideText[] = []) =>
      withHistory(id, () => saveSlides(id, pages, notes, undefined, texts))
  )

  // Versions: which scenes each cut of the video leaves out (versions.ts). Each change is one
  // undo step, the same as any other edit.
  ipcMain.handle('project:versions:read', (_event, id: string) => readVersions(id))
  ipcMain.handle('project:versions:include', (_event, id: string, itemId: string, included: boolean) =>
    withHistory(id, () => setClipIncluded(id, itemId, included))
  )
  ipcMain.handle('project:versions:create', (_event, id: string, name: string) => withHistory(id, () => createVersion(id, name)))
  ipcMain.handle('project:versions:choose', (_event, id: string, versionId: string) =>
    withHistory(id, () => chooseVersion(id, versionId))
  )
  ipcMain.handle('project:versions:rename', (_event, id: string, versionId: string, name: string) =>
    withHistory(id, () => renameVersion(id, versionId, name))
  )
  ipcMain.handle('project:versions:delete', (_event, id: string, versionId: string) =>
    withHistory(id, () => deleteVersion(id, versionId))
  )
}
