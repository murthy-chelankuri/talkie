import type { IpcMain } from 'electron'
import { sweepUnusedRevisions } from '../htmlScene/store'
import { redrawStalePosters } from '../htmlScene/htmlSceneApi'
import { homedir } from 'os'
import {
  createProject,
  listProjects,
  listProjectOverviews,
  openProject,
  sweepUnusedNarrationAudio,
  deleteProject,
  setProjectVoice,
  setProjectContext
} from '../project/projectApi'
import { projectsRootDir } from '../project/paths'
import { ProjectContextSchema } from '../project/projectContext'
import { getAssetServer, resolveAssetUrl } from '../render/assetServer'
import { clearHistory, historyState, redo, undo, withHistory } from '../project/history'
import { readSettings, updateSettings, resetSpeechSettings } from '../settings/settingsStore'
import { repairNarrationDurations } from '../transcript/repairNarrationDurations'
import { checkReadiness } from '../setup/readiness'
import { mcpConnection } from '../setup/mcpConnection'
import { createMcpToken, revokeMcpToken } from '../settings/mcpAccess'
import { describeProviders } from '../agent/providerRegistry'
import { findLocalServer } from '../agent/localProvider'
import { listCopilotModels } from '../agent/copilotModels'
import { previewVoice } from '../tts/listVoices'
import { describeSpeechEngines, speechEngine } from '../tts/engineRegistry'
import { downloadKokoro, kokoroDownloadStatus } from '../tts/kokoro/kokoroProcess'
import { draftNarrationForItem, draftNarrationForProject } from '../agent/draftNarration'
import { runProjectAgent } from '../agent/projectAgent'
import { setProjectTheme } from '../themes/applyTheme'
import { toRenderTheme } from '../themes/toRenderTheme'

export function registerProjectHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:create', (_event, name: string, context?: unknown) =>
    createProject(name, undefined, context ? ProjectContextSchema.parse(context) : undefined)
  )
  ipcMain.handle('project:list', () => listProjects())

  ipcMain.handle('project:overviews', async () => {
    const rootDir = projectsRootDir(homedir())
    const overviews = listProjectOverviews()
    if (!overviews.some((overview) => overview.posterPath)) return overviews

    // Poster media lives on disk; the renderer can only fetch it through the asset server.
    const assetServer = await getAssetServer(rootDir)
    return overviews.map((overview) =>
      overview.posterPath
        ? { ...overview, posterPath: resolveAssetUrl(overview.posterPath, rootDir, assetServer.url) }
        : overview
    )
  })

  ipcMain.handle('project:open', (_event, id: string) => {
    const project = openProject(id)
    sweepUnusedNarrationAudio(id)
    // Opening is the one moment no undo can reach an old revision of an HTML scene.
    sweepUnusedRevisions(id)
    // Not awaited: a poster drawn for another theme is fixed in the background, not before the
    // project can be seen.
    void redrawStalePosters(id).catch((err) => console.error(`Could not redraw HTML scene posters for ${id}:`, err))
    // Narration recorded before clips held a pause is sized to its audio alone, which the
    // lead-in would then push past the cut. Lengthen those clips rather than clip the voice.
    repairNarrationDurations(id)
    return project
  })

  // One undo step: the theme and, the first time, the opening and closing cards it adds.
  ipcMain.handle('project:setTheme', (_event, projectId: string, themeId: string | null) =>
    withHistory(projectId, () => setProjectTheme(projectId, themeId))
  )
  ipcMain.handle('project:theme:render', (_event, projectId: string) =>
    toRenderTheme(openProject(projectId).themeId)
  )
  ipcMain.handle('project:setVoice', (_event, projectId: string, voice: string | null) =>
    setProjectVoice(projectId, voice)
  )

  ipcMain.handle('project:setContext', (_event, projectId: string, context: unknown) =>
    setProjectContext(projectId, ProjectContextSchema.parse(context))
  )

  ipcMain.handle('project:delete', (_event, id: string) => {
    deleteProject(id)
    // Its undo stack points at files that no longer exist, and a recycled id must not inherit it.
    clearHistory(id)
  })

  ipcMain.handle('settings:read', () => readSettings())
  ipcMain.handle('settings:update', (_event, patch: unknown) => updateSettings(patch as never))
  ipcMain.handle('settings:providers', () => describeProviders())
  ipcMain.handle('settings:localServer', () => findLocalServer())
  ipcMain.handle('settings:copilotModels', () => listCopilotModels())
  ipcMain.handle('settings:resetSpeech', () => resetSpeechSettings())
  ipcMain.handle('settings:readiness', () => checkReadiness())
  ipcMain.handle('settings:mcpConnection', () => mcpConnection())

  // The token is returned here and nowhere else: only its hash is kept, so this is the one
  // moment it can be shown.
  ipcMain.handle('settings:mcpCreateToken', () => {
    const token = createMcpToken()
    return { token, connection: mcpConnection(token) }
  })

  ipcMain.handle('settings:mcpRevokeToken', () => {
    revokeMcpToken()
    return mcpConnection()
  })
  // Whichever engine is chosen — a list of macOS voices is no use to someone using Kokoro.
  ipcMain.handle('settings:voices', () => speechEngine(readSettings().speech.engine).voices())
  ipcMain.handle('settings:speechEngines', () => describeSpeechEngines())
  ipcMain.handle('settings:previewVoice', (_event, voice: string, text: string) => previewVoice(voice, text))
  // Resolves when the download is done; Settings asks for the status meanwhile to draw progress.
  ipcMain.handle('settings:kokoroDownload', () => downloadKokoro())
  ipcMain.handle('settings:kokoroStatus', () => kokoroDownloadStatus())

  // Drafted narration is an ordinary edit as far as undo is concerned.
  ipcMain.handle('project:agent:draftItem', (_event, projectId: string, itemId: string, force: boolean) =>
    withHistory(projectId, () => draftNarrationForItem(projectId, itemId, { force }))
  )
  /**
   * One instruction, run against a whole project.
   *
   * Wrapped in a single `withHistory` around the entire run rather than per change. The agent
   * works in a child process with a history of its own that dies with it, so the app's undo has
   * to cover the run as one action — which is also the only granularity that makes sense to
   * undo: "put it back to before I asked".
   */
  ipcMain.handle(
    'project:agent:instruct',
    (_event, projectId: string, instruction: string, resumeSessionId?: string) =>
      withHistory(projectId, () =>
        runProjectAgent({
          projectId,
          instruction,
          resumeSessionId,
          serverPath: mcpConnection().serverPath
        })
      )
  )

  ipcMain.handle('project:agent:draftAll', (_event, projectId: string, force: boolean) =>
    withHistory(projectId, () => draftNarrationForProject(projectId, { force }))
  )

  ipcMain.handle('project:history:state', (_event, id: string) => historyState(id))
  ipcMain.handle('project:history:undo', (_event, id: string) => undo(id))
  ipcMain.handle('project:history:redo', (_event, id: string) => redo(id))
}
