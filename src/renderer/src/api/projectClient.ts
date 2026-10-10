import type { TimelineItem } from '../../../main/project/timeline/schema'
import type { TranscriptSegment } from '../../../main/transcript/schema'
import type { ProjectContext } from '../../../main/project/projectContext'
import type { NarrationFidelity } from '../../../main/tts/voiceFidelity'

export type { TimelineItem }
export type { TranscriptSegment }

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
}

export interface ProjectMetadata extends ProjectSummary {
  schemaVersion: number
  /** The voice this project speaks in. Absent means it follows the one set in Settings. */
  voice?: string
  /** What the demo is about, given to everything that writes words for it. */
  context?: ProjectContext
  /** The theme the video follows, from the library. Absent means the look projects always had. */
  themeId?: string
}

export interface HistoryState {
  canUndo: boolean
  canRedo: boolean
}

export interface ProjectOverview extends ProjectSummary {
  clipCount: number
  durationFrames: number
  narratedCount: number
  posterPath?: string
  posterKind?: string
  posterTrimBefore?: number
}

export const projectClient = {
  create: (name: string, context?: ProjectContext): Promise<ProjectMetadata> =>
    window.api.project.create(name, context),
  list: (): Promise<ProjectSummary[]> => window.api.project.list(),
  overviews: (): Promise<ProjectOverview[]> => window.api.project.overviews(),
  open: (id: string): Promise<ProjectMetadata> => window.api.project.open(id),
  remove: (id: string): Promise<void> => window.api.project.remove(id),
  setVoice: (id: string, voice: string | null): Promise<ProjectMetadata> =>
    window.api.project.setVoice(id, voice),
  setContext: (id: string, context: ProjectContext): Promise<ProjectMetadata> =>
    window.api.project.setContext(id, context),
  setTheme: (id: string, themeId: string | null): Promise<ProjectMetadata> => window.api.project.setTheme(id, themeId),
  renderTheme: (id: string) => window.api.project.renderTheme(id),
  historyState: (id: string): Promise<HistoryState> => window.api.project.historyState(id),
  undo: (id: string): Promise<HistoryState> => window.api.project.undo(id),
  redo: (id: string): Promise<HistoryState> => window.api.project.redo(id),
  importImage: (id: string): Promise<TimelineItem | null> => window.api.project.importImage(id),
  chooseDeck: (id: string) => window.api.project.chooseDeck(id),
  saveSlides: (id: string, pages: Array<{ png: Uint8Array }>, notes: string[]) =>
    window.api.project.saveSlides(id, pages, notes)
}

export type { Settings } from '../../../main/settings/schema'
export type { ProviderDescription } from '../../../main/agent/providerRegistry'
export type { LocalServer } from '../../../main/agent/localProvider'
export type { Voice } from '../../../main/tts/listVoices'
export type { NarrationFidelity }
export type { PreparedDeck } from '../../../main/slides/importSlides'
export type { ProjectContext }
export type { SpeechEngineDescription } from '../../../main/tts/engineRegistry'
export type { KokoroDownload } from '../../../main/tts/kokoro/kokoroProcess'
export type { ReadinessCheck } from '../../../main/setup/readiness'
export type { McpConnection } from '../../../main/setup/mcpConnection'
export type { ExportedFile } from '../../../main/render/revealExport'
export type { DraftResult } from '../../../main/agent/draftNarration'

export const settingsClient = {
  read: () => window.api.settings.read(),
  update: (patch: unknown) => window.api.settings.update(patch),
  providers: () => window.api.settings.providers(),
  localServer: () => window.api.settings.localServer(),
  copilotModels: () => window.api.settings.copilotModels(),
  resetSpeech: () => window.api.settings.resetSpeech(),
  readiness: () => window.api.settings.readiness(),
  mcpConnection: () => window.api.settings.mcpConnection(),
  mcpCreateToken: () => window.api.settings.mcpCreateToken(),
  mcpRevokeToken: () => window.api.settings.mcpRevokeToken(),
  voices: () => window.api.settings.voices(),
  speechEngines: () => window.api.settings.speechEngines(),
  previewVoice: (voice: string, text: string) => window.api.settings.previewVoice(voice, text),
  kokoroDownload: () => window.api.settings.kokoroDownload(),
  kokoroStatus: () => window.api.settings.kokoroStatus()
}

export const agentClient = {
  instruct: (projectId: string, instruction: string, resumeSessionId?: string) =>
    window.api.agent.instruct(projectId, instruction, resumeSessionId),
  draftItem: (projectId: string, itemId: string, force = false) =>
    window.api.agent.draftItem(projectId, itemId, force),
  draftAll: (projectId: string, force = false) => window.api.agent.draftAll(projectId, force),
  onDrafted: (callback: (projectId: string) => void) => window.api.agent.onDrafted(callback)
}

export const timelineClient = {
  read: (id: string): Promise<TimelineItem[]> => window.api.timeline.read(id),
  addItem: (id: string, item: { kind: string; start: number; duration: number; data: unknown }): Promise<TimelineItem> =>
    window.api.timeline.addItem(id, item),
  reorder: (id: string, orderedIds: string[]): Promise<TimelineItem[]> => window.api.timeline.reorder(id, orderedIds),
  split: (id: string, timelineItemId: string, atFrame: number): Promise<TimelineItem[]> =>
    window.api.timeline.split(id, timelineItemId, atFrame),
  remove: (id: string, timelineItemId: string): Promise<TimelineItem[]> =>
    window.api.timeline.remove(id, timelineItemId)
}

export type { SceneRequest, SceneResult } from '../../../main/agent/writeScene'

export const sceneClient = {
  add: (id: string, kind: 'scene' | 'diagram', data: unknown) => window.api.scene.add(id, kind, data),
  update: (id: string, itemId: string, data: unknown) => window.api.scene.update(id, itemId, data),
  saveSvg: (id: string, svg: string) => window.api.scene.saveSvg(id, svg),
  write: (request: Parameters<typeof window.api.scene.write>[0]) => window.api.scene.write(request)
}

export const renderClient = {
  exportVideo: (id: string): Promise<string> => window.api.render.exportVideo(id),
  describe: (path: string) => window.api.render.describe(path),
  open: (path: string) => window.api.render.open(path),
  reveal: (path: string) => window.api.render.reveal(path)
}

export const captureClient = {
  openToolbar: (projectId: string): Promise<void> => window.api.capture.openToolbar(projectId),
  onSessionImported: (callback: (projectId: string) => void): (() => void) =>
    window.api.capture.onSessionImported(callback)
}

export const transcriptClient = {
  read: (projectId: string): Promise<TranscriptSegment[]> => window.api.transcript.read(projectId),
  fidelity: (projectId: string): Promise<NarrationFidelity | null> =>
    window.api.transcript.fidelity(projectId),
  addSegment: (
    projectId: string,
    input: { text: string; timelineItemId: string }
  ): Promise<TranscriptSegment> => window.api.transcript.addSegment(projectId, input),
  updateText: (projectId: string, segmentId: string, text: string): Promise<TranscriptSegment> =>
    window.api.transcript.updateText(projectId, segmentId, text),
  narrate: (projectId: string, segmentId: string): Promise<TranscriptSegment> =>
    window.api.transcript.narrate(projectId, segmentId),
  deleteSegment: (projectId: string, segmentId: string): Promise<TranscriptSegment[]> =>
    window.api.transcript.deleteSegment(projectId, segmentId),
  saveRecording: (projectId: string, segmentId: string, audio: Uint8Array): Promise<TranscriptSegment> =>
    window.api.transcript.saveRecording(projectId, segmentId, audio),
  requestMicrophone: () => window.api.transcript.requestMicrophone()
}
