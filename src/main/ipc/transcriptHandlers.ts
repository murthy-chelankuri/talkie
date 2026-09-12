import type { IpcMain } from 'electron'
import {
  readTranscript,
  addTranscriptSegment,
  updateTranscriptSegmentText,
  deleteTranscriptSegment
} from '../project/projectApi'
import { narrateSegment } from '../transcript/narrate'
import { saveRecordedNarration } from '../transcript/recordNarration'
import { ensureMicrophoneAccess } from '../transcript/microphone'
import { narrationFidelityFor } from '../transcript/narrationFidelity'
import { withHistory } from '../project/history'

export function registerTranscriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:transcript:read', (_event, projectId: string) => readTranscript(projectId))

  // Reads wav headers, so it stays out of the transcript read that runs on every keystroke.
  ipcMain.handle('project:transcript:fidelity', (_event, projectId: string) =>
    narrationFidelityFor(projectId)
  )

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

  // macOS gates the microphone behind its own prompt, which has to be asked for before the
  // page tries to use it, or getUserMedia simply fails with no explanation.
  ipcMain.handle('project:transcript:requestMicrophone', () => ensureMicrophoneAccess())

  // A take in the user's own voice, replacing whatever was there.
  ipcMain.handle(
    'project:transcript:saveRecording',
    (_event, projectId: string, segmentId: string, audio: Uint8Array) =>
      withHistory(projectId, () => saveRecordedNarration(projectId, segmentId, audio))
  )

  // Undo restores the words and timings around a narration, not the recorded audio itself.
  ipcMain.handle('project:transcript:narrate', (_event, projectId: string, segmentId: string) =>
    withHistory(projectId, () => narrateSegment(projectId, segmentId))
  )
}
