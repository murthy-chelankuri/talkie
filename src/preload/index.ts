import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectMetadata, ProjectSummary, ProjectOverview } from '../main/project/schema'
import type { HistoryState } from '../main/project/history'
import type { TimelineItem } from '../main/project/timeline/schema'
import type { TranscriptSegment } from '../main/transcript/schema'

const projectApi = {
  create: (name: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:create', name),
  list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  overviews: (): Promise<ProjectOverview[]> => ipcRenderer.invoke('project:overviews'),
  open: (id: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:open', id),
  historyState: (id: string): Promise<HistoryState> => ipcRenderer.invoke('project:history:state', id),
  undo: (id: string): Promise<HistoryState> => ipcRenderer.invoke('project:history:undo', id),
  redo: (id: string): Promise<HistoryState> => ipcRenderer.invoke('project:history:redo', id),
  importImage: (id: string): Promise<TimelineItem | null> => ipcRenderer.invoke('project:import:image', id)
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
    ipcRenderer.invoke('project:timeline:delete', id, timelineItemId)
}

const renderApi = {
  exportVideo: (id: string): Promise<string> => ipcRenderer.invoke('project:render:export', id)
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
  addSegment: (
    projectId: string,
    input: { text: string; timelineItemId: string }
  ): Promise<TranscriptSegment> => ipcRenderer.invoke('project:transcript:addSegment', projectId, input),
  updateText: (projectId: string, segmentId: string, text: string): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:updateText', projectId, segmentId, text),
  narrate: (projectId: string, segmentId: string): Promise<TranscriptSegment> =>
    ipcRenderer.invoke('project:transcript:narrate', projectId, segmentId),
  deleteSegment: (projectId: string, segmentId: string): Promise<TranscriptSegment[]> =>
    ipcRenderer.invoke('project:transcript:deleteSegment', projectId, segmentId)
}

contextBridge.exposeInMainWorld('api', {
  project: projectApi,
  timeline: timelineApi,
  render: renderApi,
  capture: captureApi,
  transcript: transcriptApi
})

export type ProjectApi = typeof projectApi
export type TimelineApi = typeof timelineApi
export type RenderApi = typeof renderApi
export type CaptureApi = typeof captureApi
export type TranscriptApi = typeof transcriptApi
