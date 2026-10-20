import { contextBridge, ipcRenderer } from 'electron'
import type { HtmlSceneInput } from '../main/htmlScene/htmlSceneApi'
import type { HtmlTemplate } from '../main/htmlScene/templates'
import type { HtmlSceneResult, HtmlSceneWriteResult } from '../main/ipc/htmlSceneHandlers'
import type { HtmlSceneData } from '../main/project/timeline/schema'
import type { ProjectMetadata, ProjectSummary, ProjectOverview } from '../main/project/schema'
import type { HistoryState } from '../main/project/history'
import type { TimelineItem } from '../main/project/timeline/schema'
import type { RewriteEvent } from '../main/menu/editContextMenu'
import type { Versions } from '../main/project/versions'
import type { TranscriptSegment } from '../main/transcript/schema'
import type { Settings } from '../main/settings/schema'
import type { RenderTheme } from '../composition/renderTheme'
import type { Theme, ThemeDraft } from '../main/themes/schema'
import type { GeneratedTheme, GenerateStatus } from '../main/themes/generate/generateTheme'
import type { ThemeTarget } from '../main/ipc/themeHandlers'
import type { ThemeFontFile } from '../main/themes/themeApi'

/** A file goes over IPC as its bytes, since the window has no path the main process could open. */
export interface GenerateThemeRequest {
  name: string
  url?: string
  description?: string
  file?: { bytes: Uint8Array; fileName: string }
}
import type { KokoroDownload } from '../main/tts/kokoro/kokoroProcess'
import type { KokoroCheck, KokoroImport, KokoroManual } from '../main/tts/kokoro/kokoroManual'
import type { ProviderDescription } from '../main/agent/providerRegistry'
import type { LocalServer } from '../main/agent/localProvider'
import type { AgentOutcome } from '../main/agent/projectAgent'
import type { Voice } from '../main/tts/listVoices'
import type { NarrationFidelity } from '../main/tts/voiceFidelity'
import type { MenuAction, MenuState } from '../main/menu/applicationMenu'
import type { PreparedDeck } from '../main/slides/importSlides'
import type { ReadinessCheck } from '../main/setup/readiness'
import type { ReportOutcome } from '../main/ipc/diagnosticsHandlers'
import type { McpConnection } from '../main/setup/mcpConnection'
import type { SpeechEngineDescription } from '../main/tts/engineRegistry'
import type { ProjectContext } from '../main/project/projectContext'
import type { ExportedFile } from '../main/render/revealExport'
import type { ExportProgress, ExportResult } from '../main/render/exportProgress'
import type { SceneRequest, SceneResult } from '../main/agent/writeScene'
import type { DraftResult } from '../main/agent/draftNarration'
import type { DiskChange } from '../main/project/diskChange'
import type { StudioInfo } from '../main/studio/describeStudio'

const projectApi = {
  create: (name: string, context?: ProjectContext): Promise<ProjectMetadata> =>
    ipcRenderer.invoke('project:create', name, context),
  list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  overviews: (): Promise<ProjectOverview[]> => ipcRenderer.invoke('project:overviews'),
  open: (id: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:open', id),
  remove: (id: string): Promise<void> => ipcRenderer.invoke('project:delete', id),
  voices: (): Promise<Voice[]> => ipcRenderer.invoke('project:voices'),
  setVoice: (id: string, voice: string | null): Promise<ProjectMetadata> =>
    ipcRenderer.invoke('project:setVoice', id, voice),
  setContext: (id: string, context: ProjectContext): Promise<ProjectMetadata> =>
    ipcRenderer.invoke('project:setContext', id, context),
  setTheme: (id: string, themeId: string | null): Promise<ProjectMetadata> =>
    ipcRenderer.invoke('project:setTheme', id, themeId),
  renderTheme: (id: string): Promise<RenderTheme | null> => ipcRenderer.invoke('project:theme:render', id),
  historyState: (id: string): Promise<HistoryState> => ipcRenderer.invoke('project:history:state', id),
  /** Reads project.json and nothing else — see projectWatchHandlers.ts for why not `open`. */
  metadata: (id: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:metadata', id),
  /** The project the editor has open, to be watched for changes made outside the app; null for none. */
  watch: (id: string | null): Promise<void> => ipcRenderer.invoke('project:watch', id),
  // An agent changed the open project from another process, so the editor reads it again.
  onChangedOnDisk: (callback: (projectId: string, change: DiskChange) => void): (() => void) => {
    const listener = (_event: unknown, projectId: string, change: DiskChange): void => callback(projectId, change)
    ipcRenderer.on('project:changedOnDisk', listener)
    return () => ipcRenderer.removeListener('project:changedOnDisk', listener)
  },
  undo: (id: string): Promise<HistoryState> => ipcRenderer.invoke('project:history:undo', id),
  redo: (id: string): Promise<HistoryState> => ipcRenderer.invoke('project:history:redo', id),
  importImage: (id: string): Promise<TimelineItem | null> => ipcRenderer.invoke('project:import:image', id),
  chooseDeck: (id: string): Promise<PreparedDeck> => ipcRenderer.invoke('project:import:deck', id),
  saveSlides: (id: string, pages: Array<{ png: Uint8Array }>, notes: string[]): Promise<TimelineItem[]> =>
    ipcRenderer.invoke('project:import:saveSlides', id, pages, notes)
}

const settingsApi = {
  read: (): Promise<Settings> => ipcRenderer.invoke('settings:read'),
  update: (patch: unknown): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
  providers: (): Promise<ProviderDescription[]> => ipcRenderer.invoke('settings:providers'),
  localServer: (): Promise<LocalServer | null> => ipcRenderer.invoke('settings:localServer'),
  copilotModels: (): Promise<string[]> => ipcRenderer.invoke('settings:copilotModels'),
  resetSpeech: (): Promise<Settings> => ipcRenderer.invoke('settings:resetSpeech'),
  readiness: (): Promise<ReadinessCheck[]> => ipcRenderer.invoke('settings:readiness'),
  reportProblem: (description: string): Promise<ReportOutcome> => ipcRenderer.invoke('settings:diagnostics:report', description),
  /** Where the Studio is, and whether it is in git. See studio/studio.ts. */
  studio: (): Promise<StudioInfo> => ipcRenderer.invoke('settings:studio:describe'),
  revealStudio: (): Promise<string | null> => ipcRenderer.invoke('settings:studio:reveal'),
  mcpConnection: (): Promise<McpConnection> => ipcRenderer.invoke('settings:mcpConnection'),
  mcpCreateToken: (): Promise<{ token: string; connection: McpConnection }> =>
    ipcRenderer.invoke('settings:mcpCreateToken'),
  mcpRevokeToken: (): Promise<McpConnection> => ipcRenderer.invoke('settings:mcpRevokeToken'),
  reinstallExamples: (): Promise<number> => ipcRenderer.invoke('settings:reinstallExamples'),
  voices: (): Promise<Voice[]> => ipcRenderer.invoke('settings:voices'),
  speechEngines: (): Promise<SpeechEngineDescription[]> => ipcRenderer.invoke('settings:speechEngines'),
  previewVoice: (voice: string, text: string): Promise<void> =>
    ipcRenderer.invoke('settings:previewVoice', voice, text),
  kokoroDownload: (): Promise<void> => ipcRenderer.invoke('settings:kokoroDownload'),
  kokoroStatus: (): Promise<KokoroDownload> => ipcRenderer.invoke('settings:kokoroStatus'),
  kokoroManual: (): Promise<KokoroManual> => ipcRenderer.invoke('settings:kokoroManual'),
  kokoroImport: (): Promise<KokoroImport | null> => ipcRenderer.invoke('settings:kokoroImport'),
  kokoroCheck: (): Promise<KokoroCheck> => ipcRenderer.invoke('settings:kokoroCheck'),
  kokoroShowFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:kokoroShowFolder')
}

const themesApi = {
  list: (): Promise<Theme[]> => ipcRenderer.invoke('settings:themes:list'),
  create: (draft: ThemeDraft, stagingDir?: string): Promise<Theme> =>
    ipcRenderer.invoke('settings:themes:create', draft, stagingDir),
  update: (id: string, draft: ThemeDraft): Promise<Theme> => ipcRenderer.invoke('settings:themes:update', id, draft),
  remove: (id: string): Promise<void> => ipcRenderer.invoke('settings:themes:delete', id),
  duplicate: (id: string): Promise<Theme> => ipcRenderer.invoke('settings:themes:duplicate', id),
  usage: (id: string): Promise<{ id: string; name: string }[]> => ipcRenderer.invoke('settings:themes:usage', id),
  generate: (request: GenerateThemeRequest): Promise<GeneratedTheme> => ipcRenderer.invoke('settings:themes:generate', request),
  generateStatus: (): Promise<GenerateStatus> => ipcRenderer.invoke('settings:themes:generateStatus'),
  addAsset: (target: ThemeTarget, kind: 'logo' | 'font', fileName: string, bytes: Uint8Array): Promise<string> =>
    ipcRenderer.invoke('settings:themes:addAsset', target, kind, fileName, bytes),
  /** A font of the person's own, read as it is saved: its family, face and weight come back. */
  addFont: (target: ThemeTarget, fileName: string, bytes: Uint8Array): Promise<ThemeFontFile> =>
    ipcRenderer.invoke('settings:themes:addFont', target, fileName, bytes),
  fontFiles: (target: ThemeTarget, files: string[]): Promise<ThemeFontFile[]> =>
    ipcRenderer.invoke('settings:themes:fontFiles', target, files),
  render: (draft: ThemeDraft, target: ThemeTarget): Promise<RenderTheme> =>
    ipcRenderer.invoke('settings:themes:render', draft, target)
}

const agentApi = {
  /** One instruction, run against the whole project. See projectAgent.ts. */
  instruct: (projectId: string, instruction: string, resumeSessionId?: string, scenes: string[] = []): Promise<AgentOutcome> =>
    ipcRenderer.invoke('project:agent:instruct', projectId, instruction, resumeSessionId, scenes),
  /** Stops the run going on for this project; what it changed stays, as one undo step. */
  stop: (projectId: string): Promise<boolean> => ipcRenderer.invoke('project:agent:stop', projectId),
  draftItem: (projectId: string, itemId: string, force = false): Promise<DraftResult> =>
    ipcRenderer.invoke('project:agent:draftItem', projectId, itemId, force),
  draftAll: (projectId: string, force = false): Promise<DraftResult[]> =>
    ipcRenderer.invoke('project:agent:draftAll', projectId, force),
  // Auto-drafting happens in the main process after an import, so the editor is told when to reload.
  onDrafted: (callback: (projectId: string) => void): (() => void) => {
    const listener = (_event: unknown, projectId: string): void => callback(projectId)
    ipcRenderer.on('project:agent:drafted', listener)
    return () => ipcRenderer.removeListener('project:agent:drafted', listener)
  }
}

const sceneApi = {
  add: (id: string, kind: 'scene' | 'diagram', data: unknown): Promise<TimelineItem> =>
    ipcRenderer.invoke('project:scene:add', id, kind, data),
  update: (id: string, itemId: string, data: unknown): Promise<TimelineItem> =>
    ipcRenderer.invoke('project:scene:update', id, itemId, data),
  saveSvg: (id: string, svg: string): Promise<string> => ipcRenderer.invoke('project:scene:saveSvg', id, svg),
  write: (request: SceneRequest): Promise<SceneResult> => ipcRenderer.invoke('project:scene:write', request)
}

const htmlSceneApi = {
  add: (id: string, input: HtmlSceneInput & { title: string }): Promise<HtmlSceneResult> =>
    ipcRenderer.invoke('project:htmlScene:add', id, input),
  edit: (id: string, itemId: string, input: HtmlSceneInput): Promise<HtmlSceneResult> =>
    ipcRenderer.invoke('project:htmlScene:edit', id, itemId, input),
  read: (id: string, itemId: string): Promise<{ data: HtmlSceneData; files: { path: string; text?: string; bytes: number }[] }> =>
    ipcRenderer.invoke('project:htmlScene:read', id, itemId),
  check: (id: string, itemId: string, atSeconds?: number[]): Promise<{ problems: string[]; frames: { atSeconds: number; url: string }[] }> =>
    ipcRenderer.invoke('project:htmlScene:check', id, itemId, atSeconds),
  import: (id: string): Promise<HtmlSceneResult | null> => ipcRenderer.invoke('project:htmlScene:import', id),
  templates: (): Promise<(HtmlTemplate & { thumbnail: string | null })[]> => ipcRenderer.invoke('project:htmlScene:templates'),
  fromTemplate: (id: string, templateId: string, title: string): Promise<HtmlSceneResult> =>
    ipcRenderer.invoke('project:htmlScene:fromTemplate', id, templateId, title),
  describe: (id: string, instruction: string, seconds?: number): Promise<HtmlSceneWriteResult> =>
    ipcRenderer.invoke('project:htmlScene:describe', id, instruction, seconds),
  change: (id: string, itemId: string, instruction: string): Promise<HtmlSceneWriteResult> =>
    ipcRenderer.invoke('project:htmlScene:change', id, itemId, instruction)
}

const timelineApi = {
  read: (id: string): Promise<TimelineItem[]> => ipcRenderer.invoke('project:timeline:read', id),
  addItem: (id: string, item: { kind: string; start: number; duration: number; data: unknown }): Promise<TimelineItem> =>
    ipcRenderer.invoke('project:timeline:addItem', id, item),
  reorder: (id: string, orderedIds: string[]): Promise<TimelineItem[]> =>
    ipcRenderer.invoke('project:timeline:reorder', id, orderedIds),
  split: (id: string, timelineItemId: string, atFrame: number): Promise<TimelineItem[]> =>
    ipcRenderer.invoke('project:timeline:split', id, timelineItemId, atFrame),
  remove: (id: string, timelineItemId: string): Promise<TimelineItem[]> =>
    ipcRenderer.invoke('project:timeline:delete', id, timelineItemId),
  versions: (id: string): Promise<Versions> => ipcRenderer.invoke('project:versions:read', id),
  include: (id: string, timelineItemId: string, included: boolean): Promise<Versions> =>
    ipcRenderer.invoke('project:versions:include', id, timelineItemId, included),
  createVersion: (id: string, name: string): Promise<Versions> => ipcRenderer.invoke('project:versions:create', id, name),
  chooseVersion: (id: string, versionId: string): Promise<Versions> => ipcRenderer.invoke('project:versions:choose', id, versionId),
  renameVersion: (id: string, versionId: string, name: string): Promise<Versions> =>
    ipcRenderer.invoke('project:versions:rename', id, versionId, name),
  deleteVersion: (id: string, versionId: string): Promise<Versions> => ipcRenderer.invoke('project:versions:delete', id, versionId)
}

const renderApi = {
  exportVideo: (id: string): Promise<ExportResult> => ipcRenderer.invoke('project:render:export', id),
  cancelExport: (id: string): Promise<boolean> => ipcRenderer.invoke('project:render:cancel', id),
  onExportProgress: (callback: (projectId: string, progress: ExportProgress) => void): (() => void) => {
    const listener = (_event: unknown, projectId: string, progress: ExportProgress): void => callback(projectId, progress)
    ipcRenderer.on('project:render:progress', listener)
    return () => ipcRenderer.removeListener('project:render:progress', listener)
  },
  describe: (path: string): Promise<ExportedFile | null> => ipcRenderer.invoke('project:render:describe', path),
  open: (path: string): Promise<string | null> => ipcRenderer.invoke('project:render:open', path),
  reveal: (path: string): Promise<string | null> => ipcRenderer.invoke('project:render:reveal', path)
}

const captureApi = {
  openToolbar: (projectId: string): Promise<void> => ipcRenderer.invoke('project:capture:openToolbar', projectId),
  // Recording happens in a separate toolbar window, so the Editor cannot await its completion —
  // the main process pushes this event once the finished recording is on the timeline.
  onSessionImported: (callback: (projectId: string) => void): (() => void) => {
    const listener = (_event: unknown, projectId: string): void => callback(projectId)
    ipcRenderer.on('project:capture:sessionImported', listener)
    return () => ipcRenderer.removeListener('project:capture:sessionImported', listener)
  }
}

const transcriptApi = {
  read: (projectId: string): Promise<TranscriptSegment[]> => ipcRenderer.invoke('project:transcript:read', projectId),
  fidelity: (projectId: string): Promise<NarrationFidelity | null> =>
    ipcRenderer.invoke('project:transcript:fidelity', projectId),
  addSegment: (
    projectId: string,
    input: { text: string; timelineItemId: string }
  ): Promise<TranscriptSegment> => ipcRenderer.invoke('project:transcript:addSegment', projectId, input),
  updateText: (projectId: string, segmentId: string, text: string): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:updateText', projectId, segmentId, text),
  narrate: (projectId: string, segmentId: string): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:narrate', projectId, segmentId),
  deleteSegment: (projectId: string, segmentId: string): Promise<TranscriptSegment[]> =>
    ipcRenderer.invoke('project:transcript:deleteSegment', projectId, segmentId),
  saveRecording: (projectId: string, segmentId: string, audio: Uint8Array): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:saveRecording', projectId, segmentId, audio),
  requestMicrophone: (): Promise<{ granted: boolean; reason?: string }> =>
    ipcRenderer.invoke('project:transcript:requestMicrophone')
}

const menuApi = {
  /** Tell the menu what is on screen, so items that cannot apply are greyed rather than inert. */
  setState: (state: Partial<MenuState>): Promise<void> => ipcRenderer.invoke('menu:setState', state),
  /** Menu items name an action; the window decides what that means where the user is. */
  onAction: (callback: (action: MenuAction) => void): (() => void) => {
    const listener = (_event: unknown, action: MenuAction): void => callback(action)
    ipcRenderer.on('menu:action', listener)
    return () => ipcRenderer.removeListener('menu:action', listener)
  },
  /** A rewrite from the right-click menu, as it starts, finishes or fails. See RewriteStatus.tsx. */
  onRewrite: (callback: (event: RewriteEvent) => void): (() => void) => {
    const listener = (_event: unknown, rewrite: RewriteEvent): void => callback(rewrite)
    ipcRenderer.on('menu:rewrite', listener)
    return () => ipcRenderer.removeListener('menu:rewrite', listener)
  }
}

contextBridge.exposeInMainWorld('api', {
  menu: menuApi,
  settings: settingsApi,
  themes: themesApi,
  agent: agentApi,
  project: projectApi,
  scene: sceneApi,
  htmlScene: htmlSceneApi,
  timeline: timelineApi,
  render: renderApi,
  capture: captureApi,
  transcript: transcriptApi
})

export type MenuApi = typeof menuApi
export type SettingsApi = typeof settingsApi
export type ThemesApi = typeof themesApi
export type AgentApi = typeof agentApi
export type SceneApi = typeof sceneApi
export type HtmlSceneApi = typeof htmlSceneApi
export type ProjectApi = typeof projectApi
export type TimelineApi = typeof timelineApi
export type RenderApi = typeof renderApi
export type CaptureApi = typeof captureApi
export type TranscriptApi = typeof transcriptApi
