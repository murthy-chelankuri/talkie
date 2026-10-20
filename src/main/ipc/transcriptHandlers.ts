import type { IpcMain } from 'electron'
import {
  readTranscript,
  addTranscriptSegment,
  updateTranscriptSegmentText,
  deleteTranscriptSegment
} from '../project/projectApi'
import { narrateSegment } from '../transcript/narrate'
import { saveRecordedNarration, setRecordingCleanUp } from '../transcript/recordNarration'
import { ensureMicrophoneAccess } from '../transcript/microphone'
import { narrationFidelityFor } from '../transcript/narrationFidelity'
import { narrationFromText } from '../transcript/narrationBeats'
import { withHistory } from '../project/history'

export function registerTranscriptHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('project:transcript:read', (_event, projectId: string) => readTranscript(projectId))

  // Reads wav headers, so it stays out of the transcript read that runs on every keystroke.
  ipcMain.handle('project:transcript:fidelity', (_event, projectId: string) =>
    narrationFidelityFor(projectId)
  )

  // Timings are read out of the words on the way in, so a take written as timed lines keeps
  // them whatever edited it. See narrationFromText.
  ipcMain.handle(
    'project:transcript:addSegment',
    (_event, projectId: string, input: { text: string; timelineItemId: string }) => {
      const { text, beats } = narrationFromText(input.text)
      return withHistory(projectId, () =>
        addTranscriptSegment(projectId, { ...input, text, beats })
      )
    }
  )

  ipcMain.handle(
    'project:transcript:updateText',
    (_event, projectId: string, segmentId: string, written: string) => {
      const { text, beats } = narrationFromText(written)
      return withHistory(projectId, () =>
        updateTranscriptSegmentText(projectId, segmentId, text, undefined, beats)
      )
    }
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

  // The same recording made again, with the clean-up on or off.
  ipcMain.handle(
    'project:transcript:cleanRecording',
    (_event, projectId: string, segmentId: string, clean: boolean) =>
      withHistory(projectId, () => setRecordingCleanUp(projectId, segmentId, clean))
  )

  // Undo restores the words and timings around a narration, not the recorded audio itself.
  ipcMain.handle('project:transcript:narrate', (_event, projectId: string, segmentId: string) =>
    withHistory(projectId, () => narrateSegment(projectId, segmentId))
  )
}
