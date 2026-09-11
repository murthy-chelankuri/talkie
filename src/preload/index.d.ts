import type {
  ProjectApi,
  TimelineApi,
  RenderApi,
  CaptureApi,
  TranscriptApi,
  SettingsApi,
  AgentApi
} from './index'

declare global {
  interface Window {
    api: {
      settings: SettingsApi
      agent: AgentApi
      project: ProjectApi
      timeline: TimelineApi
      render: RenderApi
      capture: CaptureApi
      transcript: TranscriptApi
    }
  }
}
