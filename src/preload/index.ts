import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectMetadata, ProjectSummary } from '../main/project/schema'

const projectApi = {
  create: (name: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:create', name),
  list: (): Promise<ProjectSummary[]> => ipcRenderer.invoke('project:list'),
  open: (id: string): Promise<ProjectMetadata> => ipcRenderer.invoke('project:open', id)
}

contextBridge.exposeInMainWorld('api', { project: projectApi })

export type ProjectApi = typeof projectApi
