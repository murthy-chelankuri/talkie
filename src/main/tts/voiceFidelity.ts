/**
 * How much of a voice actually survives into the file.
 *
 * A sample rate is a ceiling on bandwidth: half of it, and nothing above. The voices macOS
 * installs by default are compact ones recorded at 22050 Hz, which stops the voice at about
 * 11 kHz — under the sibilance, so an S lands soft and the whole thing reads as thin or
 * telephone-ish. No setting in this app can put that back, and re-encoding at a higher rate only
 * makes a bigger file of the same sound.
 *
 * It is worth saying out loud because the cause is invisible and the fix is not in this app: the
 * same voice, in a version recorded at 48 kHz, is a free download sitting behind a macOS
 * settings pane almost nobody has opened.
 */

/** Above this, the voice is not what is limiting the recording. */
export const FULL_BAND_RATE = 44100

/** Where the better recordings of the same voices live. */
export const MANAGE_VOICES_PATH =
  'System Settings → Accessibility → Spoken Content → System Voice → Manage Voices'

export interface NarrationFidelity {
  /** The lowest rate among the takes, which is the one that sets the ceiling. */
  lowestRate: number
  /** Named so the sentence can point at a voice rather than at a file. */
  voices: string[]
  /** How many takes are held to that ceiling. */
  takes: number
}

/**
 * Returns null when there is nothing worth saying — takes already at full band, or none at all.
 * Silence is the right answer for a project whose voices are not the limiting factor.
 */
export function summariseFidelity(
  takes: Array<{ sampleRate: number; voice?: string }>
): NarrationFidelity | null {
  const compact = takes.filter((take) => take.sampleRate > 0 && take.sampleRate < FULL_BAND_RATE)
  if (compact.length === 0) return null

  const voices = [...new Set(compact.map((take) => take.voice).filter(Boolean))] as string[]

  return {
    lowestRate: Math.min(...compact.map((take) => take.sampleRate)),
    voices: voices.sort((a, b) => a.localeCompare(b)),
    takes: compact.length
  }
}

export interface FidelityNote {
  /** One line, sized for a narrow panel. Says what is true, not what to do. */
  summary: string
  /** The measurement and the errand. Kept behind a disclosure: worth reading once, not daily. */
  detail: string
}

/**
 * The words a person reads, sized for where they are read.
 *
 * This lives under the voice picker in a rail about two hundred pixels wide, beneath a panel that
 * is already full. A paragraph there is six lines of grey that everything else has to compete
 * with — so the line always on screen is the short claim, and the evidence and the errand wait
 * behind it. Names the voice rather than the rate, because "Samantha is the compact one" is
 * something a person can act on and "22050 Hz" is something they have to look up.
 */
export function describeFidelity(fidelity: NarrationFidelity | null): FidelityNote | null {
  if (!fidelity) return null

  const { voices, lowestRate, takes } = fidelity
  const kHz = `${Math.round(lowestRate / 100) / 10} kHz`

  // One voice is talked about as a voice; none leaves nothing to name but the takes themselves.
  const one = voices.length === 1 || (voices.length === 0 && takes === 1)
  const named =
    voices.length === 0
      ? `${takes} take${takes === 1 ? '' : 's'} here ${takes === 1 ? 'uses' : 'use'} a compact voice`
      : voices.length === 1
        ? `${voices[0]} is a compact voice`
        : `${voices.slice(0, -1).join(', ')} and ${voices[voices.length - 1]} are compact voices`

  return {
    summary: `${named} — thinner than ${one ? 'it needs' : 'they need'} to be.`,
    detail:
      `Recorded at ${kHz}, about half the detail of a full-quality voice, which cuts the top off ` +
      `every S. macOS has better versions of the same voices, free to download under ` +
      `${MANAGE_VOICES_PATH}. Download one, pick it here, and re-speak the clips.`
  }
}
