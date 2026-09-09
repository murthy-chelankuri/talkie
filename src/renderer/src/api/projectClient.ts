import type { TimelineItem } from '../../../main/project/timeline/schema'

export type { TimelineItem }

export interface ProjectSummary {
  id: string
  name: string
  createdAt: string
}

export interface ProjectMetadata extends ProjectSummary {
  schemaVersion: number
}

export const projectClient = {
  create: (name: string): Promise<ProjectMetadata> => window.api.project.create(name),
  list: (): Promise<ProjectSummary[]> => window.api.project.list(),
  open: (id: string): Promise<ProjectMetadata> => window.api.project.open(id),
  importImage: (id: string): Promise<TimelineItem | null> => window.api.project.importImage(id)
}

export const timelineClient = {
  read: (id: string): Promise<TimelineItem[]> => window.api.timeline.read(id),
  addItem: (id: string, item: { kind: string; start: number; duration: number; data: unknown }): Promise<TimelineItem> =>
    window.api.timeline.addItem(id, item)
}

export const renderClient = {
  exportVideo: (id: string): Promise<string> => window.api.render.exportVideo(id)
}

export const captureClient = {
  openToolbar: (projectId: string): Promise<void> => window.api.capture.openToolbar(projectId)
}
