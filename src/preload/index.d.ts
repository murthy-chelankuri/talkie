import type { ProjectApi, TimelineApi, RenderApi, CaptureApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
      timeline: TimelineApi
      render: RenderApi
      capture: CaptureApi
    }
  }
}
