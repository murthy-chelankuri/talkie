import { Volume2 } from 'lucide-react'
import type { Voice } from '../api/projectClient'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { cn } from '../lib/cn'
import { resolveVoiceName } from '../lib/voiceNames'

/** What the picker reports when the choice is "no voice of its own". */
export const FOLLOWS_DEFAULT = ''

/**
 * Choosing a narrator, wherever the choice is being made.
 *
 * One control for both the app default and a single demo's voice, so the two cannot drift into
 * offering different lists or sorting them differently — and so the answer to "which voices can
 * I use" is the same wherever it is asked.
 */
export function VoicePicker({
  value,
  voices,
  onChange,
  onPreview,
  previewing,
  ariaLabel,
  defaultOption,
  className
}: {
  value: string
  voices: Voice[]
  onChange: (voice: string) => void
  onPreview?: () => void | Promise<void>
  previewing?: boolean
  ariaLabel: string
  /** Offered as the first choice where following something else is meaningful. */
  defaultOption?: { label: string }
  className?: string
}): JSX.Element {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <select
        aria-label={ariaLabel}
        value={resolveVoiceName(value, voices)}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 rounded-md bg-raised px-2.5 py-2 text-[13px] text-text"
      >
        {defaultOption && <option value={FOLLOWS_DEFAULT}>{defaultOption.label}</option>}
        {groupVoices(voices).map(([locale, group]) => (
          <optgroup key={locale} label={describeLocale(locale)}>
            {group.map((voice) => (
              <option key={voice.name} value={voice.name}>
                {voice.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {onPreview && (
        <Button variant="secondary" disabled={previewing} onClick={onPreview}>
          {previewing ? <Spinner size="sm" /> : <Volume2 size={15} />}
          Hear it
        </Button>
      )}
    </div>
  )
}

export function groupVoices(voices: Voice[]): Array<[string, Voice[]]> {
  const groups = new Map<string, Voice[]>()
  for (const voice of voices) {
    const existing = groups.get(voice.locale)
    if (existing) existing.push(voice)
    else groups.set(voice.locale, [voice])
  }

  const preferred = navigator.language.replace('-', '_')
  const preferredLanguage = preferred.split('_')[0]

  return [...groups.entries()]
    .map(([locale, group]) => {
      // Novelty voices stay available but never sit above a usable narrator.
      group.sort((a, b) => Number(a.novelty) - Number(b.novelty) || a.name.localeCompare(b.name))
      return [locale, group] as [string, Voice[]]
    })
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))

  function rank(locale: string): number {
    if (locale === preferred) return 0
    return locale.startsWith(preferredLanguage) ? 1 : 2
  }
}

export function describeLocale(locale: string): string {
  try {
    const [language, region] = locale.split('_')
    const languageName = new Intl.DisplayNames([navigator.language], { type: 'language' }).of(language)
    if (!region) return languageName ?? locale
    const regionName = new Intl.DisplayNames([navigator.language], { type: 'region' }).of(region)
    return `${languageName} (${regionName})`
  } catch {
    return locale
  }
}
