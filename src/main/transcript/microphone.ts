import { systemPreferences } from 'electron'

export interface MicrophoneAccess {
  granted: boolean
  reason?: string
}

/**
 * Ask macOS for the microphone before the page tries to use it.
 *
 * Without this the browser call fails with nothing useful to show the user, and once macOS has
 * been refused it will not ask again — so a refusal has to explain where to change it.
 */
export async function ensureMicrophoneAccess(): Promise<MicrophoneAccess> {
  if (process.platform !== 'darwin') return { granted: true }

  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { granted: true }

  if (status === 'denied' || status === 'restricted') {
    return {
      granted: false,
      reason:
        'Talkie has been refused the microphone. Turn it on in System Settings under Privacy & Security, Microphone.'
    }
  }

  const granted = await systemPreferences.askForMediaAccess('microphone')
  return granted
    ? { granted: true }
    : { granted: false, reason: 'Talkie needs the microphone to record narration in your own voice.' }
}
