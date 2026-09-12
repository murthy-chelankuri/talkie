import type {
  ProjectApi,
  TimelineApi,
  RenderApi,
  CaptureApi,
  TranscriptApi,
  SettingsApi,
  AgentApi,
  SceneApi
} from './index'

declare global {
  interface Window {
    api: {
      settings: SettingsApi
      agent: AgentApi
      project: ProjectApi
      scene: SceneApi
      timeline: TimelineApi
      render: RenderApi
      capture: CaptureApi
      transcript: TranscriptApi
    }
  }
}
