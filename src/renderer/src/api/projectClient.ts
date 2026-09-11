import type { TimelineItem } from '../../../main/project/timeline/schema'
import type { TranscriptSegment } from '../../../main/transcript/schema'

export type { TimelineItem }
export type { TranscriptSegment }

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
}

export interface ProjectMetadata extends ProjectSummary {
  schemaVersion: number
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
  create: (name: string): Promise<ProjectMetadata> => window.api.project.create(name),
  list: (): Promise<ProjectSummary[]> => window.api.project.list(),
  overviews: (): Promise<ProjectOverview[]> => window.api.project.overviews(),
  open: (id: string): Promise<ProjectMetadata> => window.api.project.open(id),
  remove: (id: string): Promise<void> => window.api.project.remove(id),
  historyState: (id: string): Promise<HistoryState> => window.api.project.historyState(id),
  undo: (id: string): Promise<HistoryState> => window.api.project.undo(id),
  redo: (id: string): Promise<HistoryState> => window.api.project.redo(id),
  importImage: (id: string): Promise<TimelineItem | null> => window.api.project.importImage(id)
}

export type { Settings } from '../../../main/settings/schema'
export type { ProviderDescription } from '../../../main/agent/providerRegistry'
export type { LocalServer } from '../../../main/agent/localProvider'
export type { Voice } from '../../../main/tts/listVoices'
export type { DraftResult } from '../../../main/agent/draftNarration'

export const settingsClient = {
  read: () => window.api.settings.read(),
  update: (patch: unknown) => window.api.settings.update(patch),
  providers: () => window.api.settings.providers(),
  localServer: () => window.api.settings.localServer(),
  voices: () => window.api.settings.voices(),
  previewVoice: (voice: string, text: string) => window.api.settings.previewVoice(voice, text)
}

export const agentClient = {
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

export const renderClient = {
  exportVideo: (id: string): Promise<string> => window.api.render.exportVideo(id)
}

export const captureClient = {
  openToolbar: (projectId: string): Promise<void> => window.api.capture.openToolbar(projectId),
  onSessionImported: (callback: (projectId: string) => void): (() => void) =>
    window.api.capture.onSessionImported(callback)
}

export const transcriptClient = {
  read: (projectId: string): Promise<TranscriptSegment[]> => window.api.transcript.read(projectId),
  addSegment: (
    projectId: string,
    input: { text: string; timelineItemId: string }
  ): Promise<TranscriptSegment> => window.api.transcript.addSegment(projectId, input),
  updateText: (projectId: string, segmentId: string, text: string): Promise<TranscriptSegment> =>
    window.api.transcript.updateText(projectId, segmentId, text),
  narrate: (projectId: string, segmentId: string): Promise<TranscriptSegment> =>
    window.api.transcript.narrate(projectId, segmentId),
  deleteSegment: (projectId: string, segmentId: string): Promise<TranscriptSegment[]> =>
    window.api.transcript.deleteSegment(projectId, segmentId)
}
