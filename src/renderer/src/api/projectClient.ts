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
  importImage: (id: string): Promise<TimelineItem | null> => window.api.project.importImage(id)
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
