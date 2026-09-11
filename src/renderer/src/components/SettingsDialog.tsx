import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Laptop, Cloud, Volume2, X } from 'lucide-react'
import {
  settingsClient,
  type ProviderDescription,
  type Settings,
  type LocalServer,
  type Voice
} from '../api/projectClient'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Spinner } from './ui/Spinner'
import { cn } from '../lib/cn'

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<ProviderDescription[]>([])
  const [checking, setChecking] = useState(true)
  const [localServer, setLocalServer] = useState<LocalServer | null>(null)
  const [voices, setVoices] = useState<Voice[]>([])
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    settingsClient.read().then(setSettings)
    settingsClient
      .providers()
      .then(setProviders)
      .finally(() => setChecking(false))
    settingsClient.localServer().then(setLocalServer)
    settingsClient.voices().then(setVoices)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function patchSpeech(voice: string): Promise<void> {
    setSettings(await settingsClient.update({ speech: { voice } }))
  }

  async function patch(next: Partial<Settings['narration']>): Promise<void> {
    const updated = await settingsClient.update({ narration: next })
    setSettings(updated)
    // Availability depends on the settings themselves — a key added, a model renamed.
    setProviders(await settingsClient.providers())
    setLocalServer(await settingsClient.localServer())
  }

  const selected = settings?.narration.provider
  const selectedDescription = providers.find((provider) => provider.id === selected)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-serif text-lg text-text">Settings</h2>
          <IconButton aria-label="Close settings" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4">
          {!settings ? (
            <div className="flex justify-center py-8">
              <Spinner size="md" label="Loading settings" />
            </div>
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-text">Drafting narration</h3>
                <label className="flex items-start gap-2.5 rounded-lg border border-border bg-bg p-3">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={settings.narration.autoDraft}
                    onChange={(event) => patch({ autoDraft: event.target.checked })}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm text-text">Draft narration automatically</span>
                    <span className="text-xs text-text-muted">
                      When a recording or image lands on the timeline, write a first draft for it.
                      Words you have written yourself are never replaced.
                    </span>
                  </span>
                </label>
              </section>

              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-text">Who writes the draft</h3>
                {checking ? (
                  <p className="flex items-center gap-2 text-xs text-text-muted">
                    <Spinner size="sm" /> Checking what is available…
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {providers.map((provider) => (
                      <label
                        key={provider.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
                          selected === provider.id ? 'border-accent bg-bg' : 'border-border hover:bg-surface-hover'
                        )}
                      >
                        <input
                          type="radio"
                          name="narration-provider"
                          className="mt-0.5"
                          checked={selected === provider.id}
                          onChange={() => patch({ provider: provider.id })}
                        />
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-1.5 text-sm text-text">
                            {provider.label}
                            {provider.available ? (
                              <CircleCheck size={13} className="text-success" aria-label="Ready" />
                            ) : (
                              <CircleAlert size={13} className="text-danger" aria-label="Not ready" />
                            )}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-text-muted">
                            {provider.sendsDataOffMachine ? <Cloud size={11} /> : <Laptop size={11} />}
                            {provider.sendsDataOffMachine
                              ? 'Screenshots and action logs leave this machine'
                              : 'Stays on this machine'}
                          </span>
                          {provider.reason && <span className="text-xs text-danger">{provider.reason}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>

              {voices.length > 0 && settings && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-text">Voice</h3>
                  <div className="flex items-end gap-2">
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-text-muted">
                      Reads the narration aloud
                      <select
                        aria-label="Narration voice"
                        value={settings.speech.voice}
                        onChange={(event) => patchSpeech(event.target.value)}
                        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                      >
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
                    </label>
                    <Button
                      variant="secondary"
                      disabled={previewing}
                      onClick={async () => {
                        setPreviewing(true)
                        try {
                          const chosen = voices.find((voice) => voice.name === settings.speech.voice)
                          await settingsClient.previewVoice(
                            settings.speech.voice,
                            chosen?.sample ?? 'This is how your narration will sound.'
                          )
                        } finally {
                          setPreviewing(false)
                        }
                      }}
                    >
                      {previewing ? <Spinner size="sm" /> : <Volume2 size={15} />}
                      Hear it
                    </Button>
                  </div>
                </section>
              )}

              {selected === 'local' && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-text">Local model</h3>
                  {localServer ? (
                    <>
                      <p className="text-xs text-text-muted">
                        Found {localServer.label} at {localServer.baseUrl}
                      </p>
                      <label className="flex flex-col gap-1 text-xs text-text-muted">
                        Model
                        <select
                          aria-label="Local model"
                          value={settings.narration.local.model || localServer.models[0] || ''}
                          onChange={(event) =>
                            patch({ local: { ...settings.narration.local, model: event.target.value } })
                          }
                          className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text"
                        >
                          {localServer.models.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="text-xs text-text-muted">
                        Pick a model that can read images. A text-only model will describe the action log
                        but not what is on screen.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-text-muted">
                      Looking for a server on the usual ports. LM Studio, Ollama, llama.cpp and Jan all
                      work; set an address below to use something else.
                    </p>
                  )}
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Server address (leave blank to detect)
                    <Input
                      aria-label="Local server address"
                      placeholder="http://127.0.0.1:1234/v1"
                      defaultValue={settings.narration.local.baseUrl}
                      onBlur={(event) => patch({ local: { ...settings.narration.local, baseUrl: event.target.value } })}
                    />
                  </label>
                </section>
              )}

              {selected === 'anthropic' && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-text">Anthropic</h3>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    API key
                    <Input
                      type="password"
                      aria-label="Anthropic API key"
                      placeholder="sk-ant-…"
                      defaultValue={settings.narration.anthropic.apiKey}
                      onBlur={(event) =>
                        patch({ anthropic: { ...settings.narration.anthropic, apiKey: event.target.value } })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Model
                    <Input
                      aria-label="Anthropic model"
                      defaultValue={settings.narration.anthropic.model}
                      onBlur={(event) =>
                        patch({ anthropic: { ...settings.narration.anthropic, model: event.target.value } })
                      }
                    />
                  </label>
                </section>
              )}

              {selectedDescription?.sendsDataOffMachine && (
                <p className="rounded-lg border border-border bg-bg p-3 text-xs text-text-muted">
                  Drafting with {selectedDescription.label} sends screenshots of your recordings and the
                  pages you visited to {selected === 'anthropic' ? 'Anthropic' : 'Claude'}. Choose the
                  built-in or local provider to keep everything on this machine.
                </p>
              )}
            </>
          )}
        </div>

        <footer className="flex justify-end border-t border-border px-4 py-3">
          <Button onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>
  )
}

/** Voices for the language the app is running in come first; the rest follow alphabetically. */
function groupVoices(voices: Voice[]): Array<[string, Voice[]]> {
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

function describeLocale(locale: string): string {
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
