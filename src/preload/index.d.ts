import type { ProjectApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
    }
  }
}
