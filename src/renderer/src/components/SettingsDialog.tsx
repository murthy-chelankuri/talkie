import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Laptop, Cloud, X } from 'lucide-react'
import {
  settingsClient,
  type ProviderDescription,
  type Settings
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

  useEffect(() => {
    settingsClient.read().then(setSettings)
    settingsClient
      .providers()
      .then(setProviders)
      .finally(() => setChecking(false))
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function patch(next: Partial<Settings['narration']>): Promise<void> {
    const updated = await settingsClient.update({ narration: next })
    setSettings(updated)
    // Availability depends on the settings themselves — a key added, a model renamed.
    setProviders(await settingsClient.providers())
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

              {selected === 'ollama' && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-text">Ollama</h3>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Server address
                    <Input
                      aria-label="Ollama server address"
                      defaultValue={settings.narration.ollama.baseUrl}
                      onBlur={(event) => patch({ ollama: { ...settings.narration.ollama, baseUrl: event.target.value } })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-text-muted">
                    Vision model
                    <Input
                      aria-label="Ollama model"
                      defaultValue={settings.narration.ollama.model}
                      onBlur={(event) => patch({ ollama: { ...settings.narration.ollama, model: event.target.value } })}
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
                  built-in or Ollama provider to keep everything on this machine.
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
