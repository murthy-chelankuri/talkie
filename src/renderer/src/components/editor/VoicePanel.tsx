import { AudioLines, Info } from 'lucide-react'
import type { FidelityNote } from '../../../../main/tts/voiceFidelity'
import type { TimelineItem, Voice } from '../../api/projectClient'
import { voiceProgressHint, type VoiceProgress } from '../../lib/voiceProgress'
import { cn } from '../../lib/cn'
import { Button } from '../ui/Button'
import { FOLLOWS_DEFAULT, VoicePicker } from '../VoicePicker'

/** The voice this project speaks in, and anything worth knowing about how it sounds. */
export function VoicePanel({
  timeline,
  progress,
  currentVoice,
  fidelityNote,
  onKeepProjectVoice,
  projectVoice,
  appVoice,
  voices,
  onProjectVoiceChange
}: {
  timeline: TimelineItem[]
  /** Clips still waiting on a voice, counted once in the editor and shared from there. */
  progress: VoiceProgress
  currentVoice: string
  /** Why the project sounds the way it does, when a compact voice is what is limiting it. */
  fidelityNote: FidelityNote | null
  /** Adopt the voice the narration was read in, instead of re-speaking it. */
  onKeepProjectVoice?: () => void
  /** The voice pinned to this project, or null when it follows the app's. */
  projectVoice: string | null
  appVoice: string
  voices: Voice[]
  onProjectVoiceChange: (voice: string | null) => void
}): JSX.Element {
  const hint = voiceProgressHint(progress, currentVoice)

  return (
    <div className="flex flex-col gap-3">
      {/* The voice this project speaks in, always here rather than only when something is wrong.
          It was reachable only from a card that appeared on a mismatch, which meant a voice
          could be chosen once and never changed again. */}
        <div className="flex flex-col gap-1.5 rounded-xl bg-raised p-3">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-medium text-text">Voice</span>
            {!projectVoice && (
              <span className="text-[10px] text-text-muted">from Settings</span>
            )}
          </span>
          <VoicePicker
            ariaLabel="Voice for this project"
            value={projectVoice ?? FOLLOWS_DEFAULT}
            voices={voices}
            onChange={(next) => onProjectVoiceChange(next === FOLLOWS_DEFAULT ? null : next)}
            // Short enough to read whole in a narrow panel, where the long form was cut off.
            defaultOption={{ label: appVoice ? `App default (${appVoice})` : 'App default' }}
          />
          {/* Under the picker because it describes what was picked. Not a task and not an error:
              the project sounds the way it sounds, and this is the only place that explains why. */}
          {fidelityNote && (
            <details className="group mt-0.5">
              <summary className="flex cursor-pointer list-none items-start gap-1.5 text-[10px] leading-relaxed text-text-muted marker:content-none hover:text-text">
                <Info size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0">
                  {fidelityNote.summary}{' '}
                  <span className="whitespace-nowrap text-accent group-open:hidden">
                    Improve it
                  </span>
                </span>
              </summary>
              <p className="mt-1.5 pl-[1.15rem] text-[10px] leading-relaxed text-text-muted">
                {fidelityNote.detail}
              </p>
            </details>
          )}
        </div>

      {/* Under the summary, because it qualifies it. A loose line of text here read as something
          left unstyled; what it actually needs is a card, because two of these states are a
          decision rather than a notice. */}
      {timeline.length > 0 && hint && (
        <div
          className={cn(
            'flex flex-col gap-2 rounded-xl p-3',
            progress.otherVoice.length > 0 && progress.silent.length === 0
              ? 'bg-accent-soft ring-1 ring-inset ring-accent/30'
              : 'bg-raised'
          )}
        >
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
            <AudioLines size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            {hint}
          </p>

          {/* Only for the mismatch: the project already sounds finished, so keeping it as it is
              has to be as easy as changing it. */}
          {onKeepProjectVoice && progress.previousVoice && progress.silent.length === 0 && (
            <Button variant="ghost" size="sm" className="self-start" onClick={onKeepProjectVoice}>
              Keep {progress.previousVoice} for this project
            </Button>
          )}
        </div>
      )}

    </div>
  )
}
