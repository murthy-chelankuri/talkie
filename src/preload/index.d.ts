import type { ProjectApi, TimelineApi, RenderApi, CaptureApi, TranscriptApi } from './index'

declare global {
  interface Window {
    api: {
      project: ProjectApi
      timeline: TimelineApi
      render: RenderApi
      capture: CaptureApi
      transcript: TranscriptApi
    }
  }
}
