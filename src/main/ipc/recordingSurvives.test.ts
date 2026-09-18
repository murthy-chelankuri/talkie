import { describe, expect, it } from 'vitest'
import { explainImportFailure } from './captureHandlers'
import type { RecordingResult } from '../capture/recordSession'

function recorded(videoPath = '/Users/me/Talkie/Projects/x/sources/session-1/page-1.webm'): RecordingResult {
  return {
    sessionId: 's1',
    clips: [{ videoPath, trimBeforeMs: 0, durationMs: 9000, fromSessionMs: 0 }],
    actionLogPath: '/tmp/actions.jsonl',
    contentStartMs: 0
  }
}

describe('a recording that cannot be put on a timeline', () => {
  it('says the project has gone and where the video is, not what the API called it', () => {
    // The underlying error is "No project found with id 75167b19-…", which is true and no use:
    // what matters is that the footage survived and can still be recovered.
    const said = explainImportFailure(new Error('No project found with id 75167b19'), recorded())

    expect(said).toContain('no longer exists')
    expect(said).toContain('/Users/me/Talkie/Projects/x/sources/session-1')
    expect(said).not.toContain('75167b19')
  })

  it('still points at the footage when it fails for some other reason', () => {
    const said = explainImportFailure(new Error('Disk is full'), recorded())

    expect(said).toContain('Disk is full')
    expect(said).toContain('session-1')
  })

  it('copes with a recording that produced no clip to point at', () => {
    const said = explainImportFailure(new Error('The recording produced no video'), {
      ...recorded(),
      clips: []
    })

    expect(said).toContain('the session folder')
  })
})
