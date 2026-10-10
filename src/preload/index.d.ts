import type {
  ProjectApi,
  TimelineApi,
  RenderApi,
  CaptureApi,
  TranscriptApi,
  SettingsApi,
  ThemesApi,
  AgentApi,
  SceneApi,
  MenuApi
} from './index'

declare global {
  interface Window {
    api: {
      menu: MenuApi
      settings: SettingsApi
      themes: ThemesApi
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
