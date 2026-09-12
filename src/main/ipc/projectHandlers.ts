import type { IpcMain } from 'electron'
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
import { listVoices, previewVoice } from '../tts/listVoices'
import { draftNarrationForItem, draftNarrationForProject } from '../agent/draftNarration'

export function registerProjectHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:create', (_event, name: string) => createProject(name))
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
    // Narration recorded before clips held a pause is sized to its audio alone, which the
    // lead-in would then push past the cut. Lengthen those clips rather than clip the voice.
    repairNarrationDurations(id)
    return project
  })

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
  ipcMain.handle('settings:voices', () => listVoices())
  ipcMain.handle('settings:previewVoice', (_event, voice: string, text: string) => previewVoice(voice, text))

  // Drafted narration is an ordinary edit as far as undo is concerned.
  ipcMain.handle('project:agent:draftItem', (_event, projectId: string, itemId: string, force: boolean) =>
    withHistory(projectId, () => draftNarrationForItem(projectId, itemId, { force }))
  )
  ipcMain.handle('project:agent:draftAll', (_event, projectId: string, force: boolean) =>
    withHistory(projectId, () => draftNarrationForProject(projectId, { force }))
  )

  ipcMain.handle('project:history:state', (_event, id: string) => historyState(id))
  ipcMain.handle('project:history:undo', (_event, id: string) => undo(id))
  ipcMain.handle('project:history:redo', (_event, id: string) => redo(id))
}
