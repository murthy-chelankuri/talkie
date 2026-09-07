import type { ProjectApi, TimelineApi, RenderApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
      timeline: TimelineApi
      render: RenderApi
    }
  }
}
