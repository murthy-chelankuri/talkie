import { systemPreferences } from 'electron'
import { findInstalledBrowser, hasBundledChromium } from '../capture/resolveBrowser'
import { findLibreOffice } from '../slides/libreOffice'
import { runFfmpeg } from '../media'

export interface ReadinessCheck {
  id: 'recording' | 'voice' | 'export' | 'microphone' | 'decks'
  label: string
  /** What this unlocks, so an unready item reads as a missing feature rather than an error. */
  purpose: string
  ready: boolean
  /** What is being used, when ready. */
  detail?: string
  /** What to do about it, when not. Absent means nothing needs doing. */
  fix?: string
  /** False when the app is fully usable without it. */
  required: boolean
}

/**
 * What the app can and cannot do on this machine.
 *
 * Everything here fails at the moment someone presses a button otherwise — a recording that
 * cannot find a browser, a deck that cannot be rendered — and an error at that point reads as a
 * broken app rather than something missing. Saying it up front turns each one into a choice.
 */
export async function checkReadiness(): Promise<ReadinessCheck[]> {
  return [checkRecording(), await checkExport(), checkVoice(), checkMicrophone(), checkDecks()]
}

function checkRecording(): ReadinessCheck {
  const installed = findInstalledBrowser()
  if (installed) {
    return {
      id: 'recording',
      label: 'Session recording',
      purpose: 'Capture a browser walkthrough',
      ready: true,
      detail: `Using ${installed.label}`,
      required: true
    }
  }

  if (hasBundledChromium()) {
    return {
      id: 'recording',
      label: 'Session recording',
      purpose: 'Capture a browser walkthrough',
      ready: true,
      detail: "Using Playwright's Chromium",
      required: true
    }
  }

  return {
    id: 'recording',
    label: 'Session recording',
    purpose: 'Capture a browser walkthrough',
    ready: false,
    fix: 'Install Google Chrome, or run `npx playwright install chromium` to download one.',
    required: true
  }
}

async function checkExport(): Promise<ReadinessCheck> {
  // Until step 3 of the renderer the export itself renders with Remotion's compositor, so this
  // proves Talkie's ffmpeg (recording, narration, measurement), not the export's.
  // ffmpeg is fetched on install and packaged beside the app, but it is a native binary that an
  // interrupted install or a packaging slip can leave missing, so it is proven rather than assumed.
  let ready = false
  try {
    await runFfmpeg(['-version'])
    ready = true
  } catch {
    ready = false
  }

  return {
    id: 'export',
    label: 'Video export',
    purpose: 'Render the finished project to MP4',
    ready,
    detail: ready ? 'Built in' : undefined,
    fix: ready ? undefined : `The video tools could not be run. In a checkout, run \`node scripts/fetchFfmpeg.mjs --ensure\`; otherwise reinstall the app.`,
    required: true
  }
}

function checkVoice(): ReadinessCheck {
  return {
    id: 'voice',
    label: 'Narration voice',
    purpose: 'Read narration aloud',
    ready: process.platform === 'darwin',
    detail: process.platform === 'darwin' ? "macOS's built-in voices" : undefined,
    fix: process.platform === 'darwin' ? undefined : 'Speech synthesis is only available on macOS.',
    required: true
  }
}

function checkMicrophone(): ReadinessCheck {
  const status = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'granted'
  const ready = status === 'granted'

  return {
    id: 'microphone',
    label: 'Your own voice',
    purpose: 'Record narration yourself instead of synthesising it',
    ready,
    detail: ready ? 'Allowed' : undefined,
    fix: ready
      ? undefined
      : status === 'not-determined'
        ? 'Talkie will ask for the microphone the first time you record.'
        : 'Allow Talkie the microphone in System Settings, under Privacy & Security.',
    required: false
  }
}

function checkDecks(): ReadinessCheck {
  const libreOffice = findLibreOffice()

  return {
    id: 'decks',
    label: 'PowerPoint import',
    purpose: 'Import a .pptx directly, rather than exporting it to PDF first',
    ready: Boolean(libreOffice),
    detail: libreOffice ? 'Using LibreOffice' : undefined,
    fix: libreOffice
      ? undefined
      : 'PDF decks import without this. For .pptx files, install LibreOffice: `brew install --cask libreoffice`.',
    required: false
  }
}

/** Whether anything the app cannot work without is missing. */
export function hasBlockingGap(checks: ReadinessCheck[]): boolean {
  return checks.some((check) => check.required && !check.ready)
}
