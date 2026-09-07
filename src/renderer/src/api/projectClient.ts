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
  open: (id: string): Promise<ProjectMetadata> => window.api.project.open(id)
}
