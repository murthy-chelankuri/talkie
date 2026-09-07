import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectMetadata, ProjectSummary } from '../main/project/schema'
import type { TimelineItem } from '../main/project/timeline/schema'

const projectApi = {
  create: (name: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:create', name),
  list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  open: (id: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:open', id),
  importImage: (id: string): Promise<TimelineItem | null> => ipcRenderer.invoke('project:import:image', id)
}

const timelineApi = {
  read: (id: string): Promise<TimelineItem[]> => ipcRenderer.invoke('project:timeline:read', id),
  addItem: (id: string, item: { kind: string; start: number; duration: number; data: unknown }): Promise<TimelineItem> =>
    ipcRenderer.invoke('project:timeline:addItem', id, item)
}

const renderApi = {
  exportVideo: (id: string): Promise<string> => ipcRenderer.invoke('project:render:export', id)
}

contextBridge.exposeInMainWorld('api', { project: projectApi, timeline: timelineApi, render: renderApi })

export type ProjectApi = typeof projectApi
export type TimelineApi = typeof timelineApi
export type RenderApi = typeof renderApi
