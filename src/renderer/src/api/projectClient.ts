import type { TimelineItem } from '../../../main/project/timeline/schema'
import type { Versions } from '../../../main/project/versions'
import type { DiskChange } from '../../../main/project/diskChange'
import { notifySettingsChanged } from '../lib/settingsChanged'
import type { TranscriptSegment } from '../../../main/transcript/schema'
import type { ProjectContext } from '../../../main/project/projectContext'
import type { NarrationFidelity } from '../../../main/tts/voiceFidelity'
import type { Voice } from '../../../main/tts/listVoices'

export type { TimelineItem }
export type { TranscriptSegment }

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
  /** Which of the examples Talkie ships with this is, when it is one. */
  example?: string
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
  /** Every voice a project can be read in, from every engine that is ready. */
  voices: (): Promise<Voice[]> => window.api.project.voices(),
  setVoice: (id: string, voice: string | null): Promise<ProjectMetadata> =>
    window.api.project.setVoice(id, voice),
  setContext: (id: string, context: ProjectContext): Promise<ProjectMetadata> =>
    window.api.project.setContext(id, context),
  setTheme: (id: string, themeId: string | null): Promise<ProjectMetadata> => window.api.project.setTheme(id, themeId),
  renderTheme: (id: string) => window.api.project.renderTheme(id),
  historyState: (id: string): Promise<HistoryState> => window.api.project.historyState(id),
  metadata: (id: string): Promise<ProjectMetadata> => window.api.project.metadata(id),
  watch: (id: string | null): Promise<void> => window.api.project.watch(id),
  onChangedOnDisk: (callback: (projectId: string, change: DiskChange) => void): (() => void) =>
    window.api.project.onChangedOnDisk(callback),
  undo: (id: string): Promise<HistoryState> => window.api.project.undo(id),
  redo: (id: string): Promise<HistoryState> => window.api.project.redo(id),
  importImage: (id: string): Promise<TimelineItem | null> => window.api.project.importImage(id),
  importVideo: (id: string): Promise<TimelineItem[] | null> => window.api.project.importVideo(id),
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
export type { KokoroCheck, KokoroImport, KokoroManual } from '../../../main/tts/kokoro/kokoroManual'
export type { ReadinessCheck } from '../../../main/setup/readiness'
export type { ReportOutcome } from '../../../main/ipc/diagnosticsHandlers'
export type { McpConnection } from '../../../main/setup/mcpConnection'
export type { ExportedFile } from '../../../main/render/revealExport'
import type { ExportProgress, ExportResult } from '../../../main/render/exportProgress'
export type { ExportResult, ExportProgress }
export type { DraftResult } from '../../../main/agent/draftNarration'

export const settingsClient = {
  read: () => window.api.settings.read(),
  update: (patch: unknown) => window.api.settings.update(patch),
  providers: () => window.api.settings.providers(),
  localServer: () => window.api.settings.localServer(),
  copilotModels: () => window.api.settings.copilotModels(),
  resetSpeech: () => window.api.settings.resetSpeech(),
  readiness: () => window.api.settings.readiness(),
  reportProblem: (description: string) => window.api.settings.reportProblem(description),
  studio: () => window.api.settings.studio(),
  revealStudio: () => window.api.settings.revealStudio(),
  mcpConnection: () => window.api.settings.mcpConnection(),
  mcpCreateToken: () => window.api.settings.mcpCreateToken(),
  mcpRevokeToken: () => window.api.settings.mcpRevokeToken(),
  reinstallExamples: () => window.api.settings.reinstallExamples(),
  voices: () => window.api.settings.voices(),
  speechEngines: () => window.api.settings.speechEngines(),
  previewVoice: (voice: string, text: string) => window.api.settings.previewVoice(voice, text),
  kokoroDownload: () => window.api.settings.kokoroDownload(),
  kokoroStatus: () => window.api.settings.kokoroStatus(),
  kokoroManual: () => window.api.settings.kokoroManual(),
  kokoroImport: () => window.api.settings.kokoroImport(),
  kokoroCheck: () => window.api.settings.kokoroCheck(),
  kokoroShowFolder: () => window.api.settings.kokoroShowFolder()
}

export const agentClient = {
  instruct: (projectId: string, instruction: string, resumeSessionId?: string, scenes: string[] = []) =>
    window.api.agent.instruct(projectId, instruction, resumeSessionId, scenes),
  stop: (projectId: string) => window.api.agent.stop(projectId),
  readiness: () => window.api.agent.readiness(),
  onStep: (callback: (projectId: string, step: string) => void) => window.api.agent.onStep(callback),
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
    window.api.timeline.remove(id, timelineItemId),
  versions: (id: string): Promise<Versions> => window.api.timeline.versions(id),
  include: (id: string, timelineItemId: string, included: boolean): Promise<Versions> =>
    window.api.timeline.include(id, timelineItemId, included),
  createVersion: (id: string, name: string): Promise<Versions> => window.api.timeline.createVersion(id, name),
  chooseVersion: (id: string, versionId: string): Promise<Versions> => window.api.timeline.chooseVersion(id, versionId),
  renameVersion: (id: string, versionId: string, name: string): Promise<Versions> =>
    window.api.timeline.renameVersion(id, versionId, name),
  deleteVersion: (id: string, versionId: string): Promise<Versions> => window.api.timeline.deleteVersion(id, versionId)
}

export type { SceneRequest, SceneResult } from '../../../main/agent/writeScene'

export const sceneClient = {
  add: (id: string, kind: 'scene' | 'diagram', data: unknown) => window.api.scene.add(id, kind, data),
  update: (id: string, itemId: string, data: unknown) => window.api.scene.update(id, itemId, data),
  saveSvg: (id: string, svg: string) => window.api.scene.saveSvg(id, svg),
  write: (request: Parameters<typeof window.api.scene.write>[0]) => window.api.scene.write(request)
}

export const renderClient = {
  exportVideo: (id: string): Promise<ExportResult> => window.api.render.exportVideo(id),
  cancelExport: (id: string): Promise<boolean> => window.api.render.cancelExport(id),
  onExportProgress: (callback: (projectId: string, progress: ExportProgress) => void): (() => void) =>
    window.api.render.onExportProgress(callback),
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
  cleanRecording: (projectId: string, segmentId: string, clean: boolean): Promise<TranscriptSegment> =>
    window.api.transcript.cleanRecording(projectId, segmentId, clean),
  requestMicrophone: () => window.api.transcript.requestMicrophone()
}

export type { Theme, ThemeDraft, Variant, VariantId } from '../../../main/themes/schema'
export type { GeneratedTheme, GenerateStatus } from '../../../main/themes/generate/generateTheme'
export type { ThemeTarget } from '../../../main/ipc/themeHandlers'
export type { GenerateThemeRequest } from '../../../preload/index'
export type { RenderTheme } from '../../../composition/renderTheme'

/**
 * Themes are edited in Settings while a project stays open behind it, and the project re-read its
 * theme only when it chose a different one — so an edited colour waited until the project was next
 * opened, in the preview and the thumbnails both.
 */
async function announcing<T>(change: Promise<T>): Promise<T> {
  const result = await change
  notifySettingsChanged()
  return result
}

export const themeClient = {
  list: () => window.api.themes.list(),
  create: (...args: Parameters<Window['api']['themes']['create']>) => announcing(window.api.themes.create(...args)),
  update: (...args: Parameters<Window['api']['themes']['update']>) => announcing(window.api.themes.update(...args)),
  remove: (id: string) => announcing(window.api.themes.remove(id)),
  duplicate: (id: string) => window.api.themes.duplicate(id),
  usage: (id: string) => window.api.themes.usage(id),
  generate: (...args: Parameters<Window['api']['themes']['generate']>) => window.api.themes.generate(...args),
  generateStatus: () => window.api.themes.generateStatus(),
  compliance: (...args: Parameters<Window['api']['themes']['compliance']>) => window.api.themes.compliance(...args),
  addAsset: (...args: Parameters<Window['api']['themes']['addAsset']>) => announcing(window.api.themes.addAsset(...args)),
  addFont: (...args: Parameters<Window['api']['themes']['addFont']>) => window.api.themes.addFont(...args),
  fontFiles: (...args: Parameters<Window['api']['themes']['fontFiles']>) => window.api.themes.fontFiles(...args),
  render: (...args: Parameters<Window['api']['themes']['render']>) => window.api.themes.render(...args)
}

export type { HtmlSceneResult, HtmlSceneWriteResult } from '../../../main/ipc/htmlSceneHandlers'
export type { HtmlSceneInput } from '../../../main/htmlScene/htmlSceneApi'
export type { HtmlSceneData } from '../../../main/project/timeline/schema'

export const htmlSceneClient = {
  add: (...args: Parameters<Window['api']['htmlScene']['add']>) => window.api.htmlScene.add(...args),
  edit: (...args: Parameters<Window['api']['htmlScene']['edit']>) => window.api.htmlScene.edit(...args),
  read: (id: string, itemId: string) => window.api.htmlScene.read(id, itemId),
  check: (id: string, itemId: string, atSeconds?: number[]) => window.api.htmlScene.check(id, itemId, atSeconds),
  import: (id: string) => window.api.htmlScene.import(id),
  templates: () => window.api.htmlScene.templates(),
  fromTemplate: (id: string, templateId: string, title: string) => window.api.htmlScene.fromTemplate(id, templateId, title),
  describe: (id: string, instruction: string, seconds?: number) => window.api.htmlScene.describe(id, instruction, seconds),
  change: (id: string, itemId: string, instruction: string) => window.api.htmlScene.change(id, itemId, instruction)
}
