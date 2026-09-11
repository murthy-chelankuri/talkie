import type { IpcMain } from 'electron'
import {
  readTranscript,
  addTranscriptSegment,
  updateTranscriptSegmentText,
  deleteTranscriptSegment
} from '../project/projectApi'
import { narrateSegment } from '../transcript/narrate'
import { withHistory } from '../project/history'

export function registerTranscriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:transcript:read', (_event, projectId: string) => readTranscript(projectId))

  ipcMain.handle(
    'project:transcript:addSegment',
    (_event, projectId: string, input: { text: string; timelineItemId: string }) =>
      withHistory(projectId, () => addTranscriptSegment(projectId, input))
  )

  ipcMain.handle('project:transcript:updateText', (_event, projectId: string, segmentId: string, text: string) =>
    withHistory(projectId, () => updateTranscriptSegmentText(projectId, segmentId, text))
  )

  ipcMain.handle('project:transcript:deleteSegment', (_event, projectId: string, segmentId: string) =>
    withHistory(projectId, () => deleteTranscriptSegment(projectId, segmentId))
  )

  // Undo restores the words and timings around a narration, not the recorded audio itself.
  ipcMain.handle('project:transcript:narrate', (_event, projectId: string, segmentId: string) =>
    withHistory(projectId, () => narrateSegment(projectId, segmentId))
  )
}
