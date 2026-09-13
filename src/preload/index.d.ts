import type {
  ProjectApi,
  TimelineApi,
  RenderApi,
  CaptureApi,
  TranscriptApi,
  SettingsApi,
  AgentApi,
  SceneApi,
  MenuApi
} from './index'

declare global {
  interface Window {
    api: {
      menu: MenuApi
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
