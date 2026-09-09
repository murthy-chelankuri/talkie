import type { IpcMain } from 'electron'
import {
  readTranscript,
  addTranscriptSegment,
  updateTranscriptSegmentText
} from '../project/projectApi'
import { narrateSegment } from '../transcript/narrate'

export function registerTranscriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:transcript:read', (_event, projectId: string) => readTranscript(projectId))

  ipcMain.handle(
    'project:transcript:addSegment',
    (_event, projectId: string, input: { text: string; timelineItemId: string }) =>
      addTranscriptSegment(projectId, input)
  )

  ipcMain.handle('project:transcript:updateText', (_event, projectId: string, segmentId: string, text: string) =>
    updateTranscriptSegmentText(projectId, segmentId, text)
  )

  ipcMain.handle('project:transcript:narrate', (_event, projectId: string, segmentId: string) =>
    narrateSegment(projectId, segmentId)
  )
}
