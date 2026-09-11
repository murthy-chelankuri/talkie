/**
 * Record a take from the microphone.
 *
 * Kept apart from the components so the browser plumbing — permission, MediaRecorder, releasing
 * the microphone afterwards — is in one place and the narration box only has to start and stop.
 */
export interface VoiceRecording {
  stop: () => Promise<Uint8Array>
  cancel: () => void
}

/** Opus in a webm container is what Chromium records; the main process converts it to WAV. */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

export async function startVoiceRecording(): Promise<VoiceRecording> {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      // A spoken take wants the voice, not the room.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
  } catch (err) {
    throw new Error(
      err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
        ? 'Talkie needs permission to use the microphone. Allow it in System Settings under Privacy & Security.'
        : 'No microphone was available to record from.'
    )
  }

  const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type))
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const release = (): void => {
    for (const track of stream.getTracks()) track.stop()
  }

  recorder.start()

  return {
    async stop(): Promise<Uint8Array> {
      const finished = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      recorder.stop()
      await finished
      release()

      const blob = new Blob(chunks, { type: recorder.mimeType })
      if (blob.size === 0) throw new Error('The recording came out empty.')
      return new Uint8Array(await blob.arrayBuffer())
    },

    cancel(): void {
      // Releasing the microphone matters even when the take is thrown away.
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    }
  }
}
