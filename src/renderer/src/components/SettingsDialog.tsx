import { useEffect, useState, type ReactNode } from 'react'
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Copy,
  Laptop,
  Plug,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  Video,
  Volume2,
  Wrench,
  X
} from 'lucide-react'
import {
  settingsClient,
  type ProviderDescription,
  type Settings,
  type LocalServer,
  type Voice,
  type ReadinessCheck,
  type McpConnection
} from '../api/projectClient'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Spinner } from './ui/Spinner'
import { cn } from '../lib/cn'
import { notifySettingsChanged } from '../lib/settingsChanged'
import { VoicePicker } from './VoicePicker'

type SectionId = 'narration' | 'voice' | 'recording' | 'system'

const SECTIONS: Array<{ id: SectionId; label: string; icon: ReactNode; blurb: string }> = [
  { id: 'narration', label: 'Narration', icon: <Sparkles size={15} />, blurb: 'Who writes the words' },
  { id: 'voice', label: 'Voice', icon: <Volume2 size={15} />, blurb: 'How they are spoken' },
  { id: 'recording', label: 'Recording', icon: <Video size={15} />, blurb: 'What a capture shows' },
  { id: 'system', label: 'System', icon: <Wrench size={15} />, blurb: 'What this machine can do' }
]

/**
 * Settings are split by what the user came here to change, rather than stacked in one column.
 *
 * Status is deliberately quiet: a green tick against everything that works turns the screen into
 * a report card and buries the one line that matters. A working provider says nothing, and a
 * missing one says what it is for and what to do — with the only standing signal a dot on the
 * section that needs attention.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [section, setSection] = useState<SectionId>('narration')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [providers, setProviders] = useState<ProviderDescription[]>([])
  const [voices, setVoices] = useState<Voice[]>([])
  const [localServer, setLocalServer] = useState<LocalServer | null>(null)
  const [readiness, setReadiness] = useState<ReadinessCheck[]>([])
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    settingsClient.read().then(setSettings)
    settingsClient.providers().then(setProviders)
    settingsClient.voices().then(setVoices)
    settingsClient.localServer().then(setLocalServer)
    settingsClient.readiness().then(setReadiness)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  async function apply(next: Promise<Settings>): Promise<void> {
    setSettings(await next)
    notifySettingsChanged()
    // Availability depends on the settings themselves — a key added, a model renamed.
    setProviders(await settingsClient.providers())
    setLocalServer(await settingsClient.localServer())
  }

  const patchNarration = (next: Partial<Settings['narration']>): Promise<void> =>
    apply(settingsClient.update({ narration: next }))
  const patchSpeech = (next: Partial<Settings['speech']>): Promise<void> =>
    apply(settingsClient.update({ speech: next }))
  const patchRecording = (next: Partial<Settings['recording']>): Promise<void> =>
    apply(settingsClient.update({ recording: next }))

  const needsAttention = readiness.filter((check) => !check.ready && check.required).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[34rem] max-h-full w-full max-w-3xl overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
      >
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-border bg-bg p-2.5">
          <p className="px-2.5 pb-2 pt-1 font-serif text-base text-text">Settings</p>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setSection(item.id)}
              aria-current={section === item.id}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border-0 px-2.5 py-2 text-left transition-colors',
                section === item.id
                  ? 'bg-surface text-text shadow-sm'
                  : 'bg-transparent text-text-muted hover:text-text'
              )}
            >
              <span className={cn('shrink-0', section === item.id ? 'text-accent' : 'text-text-muted')}>
                {item.icon}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] font-medium leading-tight">{item.label}</span>
                <span className="truncate text-[11px] leading-tight text-text-muted">{item.blurb}</span>
              </span>
              {item.id === 'system' && needsAttention > 0 && (
                <span
                  aria-label={`${needsAttention} needing attention`}
                  className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-danger"
                />
              )}
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-medium text-text">
              {SECTIONS.find((item) => item.id === section)?.label}
            </h2>
            <IconButton aria-label="Close settings" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {!settings ? (
              <div className="flex h-full items-center justify-center">
                <Spinner size="md" label="Loading settings" />
              </div>
            ) : section === 'narration' ? (
              <NarrationSection
                settings={settings}
                providers={providers}
                localServer={localServer}
                onPatch={patchNarration}
              />
            ) : section === 'voice' ? (
              <VoiceSection
                settings={settings}
                voices={voices}
                previewing={previewing}
                onPatch={patchSpeech}
                onPreview={async () => {
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
                onReset={() => apply(settingsClient.resetSpeech())}
              />
            ) : section === 'recording' ? (
              <RecordingSection settings={settings} onPatch={patchRecording} />
            ) : (
              <SystemSection checks={readiness} />
            )}
          </div>

          <footer className="flex shrink-0 justify-end border-t border-border px-5 py-3">
            <Button onClick={onClose}>Done</Button>
          </footer>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-text">{label}</span>
        {hint && <span className="text-xs leading-relaxed text-text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full border-0 p-0 transition-colors',
        checked ? 'bg-accent' : 'bg-border'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
          checked ? 'left-[1.125rem]' : 'left-0.5'
        )}
      />
    </button>
  )
}

function NarrationSection({
  settings,
  providers,
  localServer,
  onPatch
}: {
  settings: Settings
  providers: ProviderDescription[]
  localServer: LocalServer | null
  onPatch: (next: Partial<Settings['narration']>) => Promise<void>
}): JSX.Element {
  const selected = settings.narration.provider

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-6 rounded-lg border border-border bg-bg px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-text">Draft narration automatically</span>
          <span className="text-xs leading-relaxed text-text-muted">
            Write a first draft when a recording or slide lands on the timeline. Words you have
            written yourself are never replaced.
          </span>
        </div>
        <Switch
          label="Draft narration automatically"
          checked={settings.narration.autoDraft}
          onChange={(next) => onPatch({ autoDraft: next })}
        />
      </div>

      <Field label="Who writes the draft">
        <div className="flex flex-col gap-1.5">
          {providers.map((provider) => (
            <label
              key={provider.id}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors',
                selected === provider.id
                  ? 'border-accent bg-bg'
                  : 'border-border hover:border-text-muted/40'
              )}
            >
              <input
                type="radio"
                name="narration-provider"
                className="mt-1 accent-accent"
                checked={selected === provider.id}
                onChange={() => onPatch({ provider: provider.id })}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="text-[13px] text-text">{provider.label}</span>
                  <span
                    className="flex items-center gap-1 text-[11px] text-text-muted"
                    title={
                      provider.sendsDataOffMachine
                        ? 'Screenshots and action logs are sent to this service'
                        : 'Nothing leaves this machine'
                    }
                  >
                    {provider.sendsDataOffMachine ? <Cloud size={11} /> : <Laptop size={11} />}
                    {provider.sendsDataOffMachine ? 'Sends data out' : 'Stays on this machine'}
                  </span>
                </span>
                {/* A provider that works says nothing; only a problem is worth the user's eye. */}
                {!provider.available && provider.reason && (
                  <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
                    <TriangleAlert size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
                    {provider.reason}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </Field>

      {selected === 'local' && (
        <Field
          label="Local model"
          hint={
            localServer
              ? `Found ${localServer.label} at ${localServer.baseUrl}. Pick a model that can read images — a text-only one will describe the action log but not what is on screen.`
              : 'Looking on the usual ports. LM Studio, Ollama, llama.cpp and Jan all work; set an address to use something else.'
          }
        >
          <div className="flex flex-col gap-2">
            {localServer && (
              <select
                aria-label="Local model"
                value={settings.narration.local.model || localServer.models[0] || ''}
                onChange={(event) => onPatch({ local: { ...settings.narration.local, model: event.target.value } })}
                className="rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-text"
              >
                {localServer.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            )}
            <Input
              aria-label="Local server address"
              placeholder="Leave blank to detect — http://127.0.0.1:1234/v1"
              defaultValue={settings.narration.local.baseUrl}
              onBlur={(event) => onPatch({ local: { ...settings.narration.local, baseUrl: event.target.value } })}
            />
          </div>
        </Field>
      )}

      {selected === 'anthropic' && (
        <Field label="Anthropic" hint="The key is kept in your settings file and sent only to Anthropic.">
          <div className="flex flex-col gap-2">
            <Input
              type="password"
              aria-label="Anthropic API key"
              placeholder="sk-ant-…"
              defaultValue={settings.narration.anthropic.apiKey}
              onBlur={(event) =>
                onPatch({ anthropic: { ...settings.narration.anthropic, apiKey: event.target.value } })
              }
            />
            <Input
              aria-label="Anthropic model"
              defaultValue={settings.narration.anthropic.model}
              onBlur={(event) =>
                onPatch({ anthropic: { ...settings.narration.anthropic, model: event.target.value } })
              }
            />
          </div>
        </Field>
      )}
    </div>
  )
}

function VoiceSection({
  settings,
  voices,
  previewing,
  onPatch,
  onPreview,
  onReset
}: {
  settings: Settings
  voices: Voice[]
  previewing: boolean
  onPatch: (next: Partial<Settings['speech']>) => Promise<void>
  onPreview: () => void | Promise<void>
  onReset: () => void | Promise<void>
}): JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      {/* A default rather than the answer: a project that has chosen a voice keeps it, which is
          what stops changing this from making finished work look unfinished. */}
      <Field
        label="Default voice for new projects"
        hint="Each project can use a voice of its own — set that while editing it."
      >
        <VoicePicker
          ariaLabel="Narration voice"
          value={settings.speech.voice}
          voices={voices}
          onChange={(voice) => void onPatch({ voice })}
          onPreview={onPreview}
          previewing={previewing}
        />
      </Field>

      <Field
        label="Delivery"
        hint="Explaining runs slower than reading, and a real stop at a full stop is what keeps it from sounding recited."
      >
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-bg px-4 py-3.5">
          <Slider
            label="Pace"
            value={`${settings.speech.pace} words a minute`}
            ariaLabel="Speaking pace"
            min={110}
            max={230}
            step={5}
            current={settings.speech.pace}
            onChange={(pace) => onPatch({ pace })}
          />
          <Slider
            label="Pause at a full stop"
            value={`${(settings.speech.sentencePauseMs / 1000).toFixed(2)} seconds`}
            ariaLabel="Pause between sentences"
            min={0}
            max={1200}
            step={20}
            current={settings.speech.sentencePauseMs}
            onChange={(sentencePauseMs) => onPatch({ sentencePauseMs })}
          />
        </div>
      </Field>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <p className="text-xs leading-relaxed text-text-muted">
          Narration already voiced keeps the voice and pacing it was recorded with. Narrate a clip
          again to hear a change.
        </p>
        <Button variant="ghost" onClick={onReset} className="shrink-0">
          <RotateCcw size={14} />
          Reset to defaults
        </Button>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  ariaLabel,
  min,
  max,
  step,
  current,
  onChange
}: {
  label: string
  value: string
  ariaLabel: string
  min: number
  max: number
  step: number
  current: number
  onChange: (next: number) => void
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-text">{label}</span>
        <span className="text-xs tabular-nums text-text-muted">{value}</span>
      </span>
      <input
        type="range"
        aria-label={ariaLabel}
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-accent"
      />
    </label>
  )
}

/**
 * How to point an agent at this copy of Talkie.
 *
 * The path is the only part a user cannot work out for themselves — it differs between a
 * checkout and an installed app — so it is filled in for them, ready to copy.
 */
function McpSection(): JSX.Element | null {
  const [connection, setConnection] = useState<McpConnection | null>(null)
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [copied, setCopied] = useState<'config' | 'command' | 'token' | null>(null)

  useEffect(() => {
    settingsClient.mcpConnection().then(setConnection).catch(() => undefined)
  }, [])

  if (!connection) return null

  function copy(what: 'config' | 'command' | 'token', value: string): void {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(what)
      setTimeout(() => setCopied(null), 1600)
    })
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    await settingsClient.update({ mcp: { enabled } })
    setConnection(await settingsClient.mcpConnection())
    notifySettingsChanged()
  }

  async function createToken(): Promise<void> {
    const { token, connection: next } = await settingsClient.mcpCreateToken()
    setFreshToken(token)
    setConnection(next)
  }

  async function revokeToken(): Promise<void> {
    setFreshToken(null)
    setConnection(await settingsClient.mcpRevokeToken())
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <Plug size={13} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="text-[13px] font-medium text-text">Let AI agents connect</span>
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Any MCP client — Claude Code, Copilot CLI, Cursor — can record sessions, write slides
            and export video here. Off unless you turn it on, and it needs a token even then.
          </span>
        </span>
        <Switch
          label="Let AI agents connect"
          checked={connection.enabled}
          onChange={(next) => void setEnabled(next)}
        />
      </div>

      {connection.enabled && !connection.serverPath && (
        <p className="text-xs text-danger">
          The MCP server is not built in this copy. Run <code>npm run build</code> to create it.
        </p>
      )}

      {connection.enabled && connection.serverPath && (
        <>
          {!connection.hasToken ? (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
              <span className="text-xs leading-relaxed text-text-muted">
                No token yet. Nothing can connect until you make one.
              </span>
              <Button onClick={createToken}>Create a token</Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
              <span className="text-xs leading-relaxed text-text-muted">
                {connection.tokenCreatedAt
                  ? `Token created ${new Date(connection.tokenCreatedAt).toLocaleDateString()}.`
                  : 'A token exists.'}{' '}
                Replacing it stops anything still using the old one.
              </span>
              <span className="flex shrink-0 gap-2">
                <Button variant="ghost" onClick={revokeToken}>
                  Revoke
                </Button>
                <Button onClick={createToken}>Replace</Button>
              </span>
            </div>
          )}

          {freshToken && (
            <div className="flex flex-col gap-2 rounded-lg border border-accent bg-accent/5 p-4">
              <span className="text-[13px] font-medium text-text">
                Copy this now — it is not shown again
              </span>
              <span className="text-xs leading-relaxed text-text-muted">
                Only a hash is kept, so Talkie cannot show it to you later. If you lose it, make
                another.
              </span>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-text">
                  {freshToken}
                </pre>
                <IconButton
                  aria-label="Copy the token"
                  onClick={() => copy('token', freshToken)}
                  className="mt-1 shrink-0"
                >
                  {copied === 'token' ? <Check size={13} /> : <Copy size={13} />}
                </IconButton>
              </div>
            </div>
          )}

          {connection.hasToken && (
            <>
              <p className="text-xs text-text-muted">
                {freshToken
                  ? 'Add it to your agent with:'
                  : 'Add it to your agent with this, putting your token in place of YOUR_TOKEN:'}
              </p>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-text">
                  {connection.addCommand}
                </pre>
                <IconButton
                  aria-label="Copy the command"
                  onClick={() => copy('command', connection.addCommand)}
                  className="mt-1 shrink-0"
                >
                  {copied === 'command' ? <Check size={13} /> : <Copy size={13} />}
                </IconButton>
              </div>

              <p className="text-xs text-text-muted">Or paste this into any other client’s config:</p>
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 text-[11px] leading-relaxed text-text">
                  {connection.configJson}
                </pre>
                <IconButton
                  aria-label="Copy the configuration"
                  onClick={() => copy('config', connection.configJson)}
                  className="mt-1 shrink-0"
                >
                  {copied === 'config' ? <Check size={13} /> : <Copy size={13} />}
                </IconButton>
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** A few colours that read clearly over a page, plus whatever the user picks. */
const HIGHLIGHT_COLOURS = ['#d3a24c', '#f87171', '#4ade80', '#38bdf8', '#c084fc', '#f59e0b']

/**
 * What a recording shows besides the page.
 *
 * The setting exists because the highlight is burned into the video: there is no turning it off
 * afterwards, so the choice has to be made before recording rather than regretted after.
 */
function RecordingSection({
  settings,
  onPatch
}: {
  settings: Settings
  onPatch: (next: Partial<Settings['recording']>) => void
}): JSX.Element {
  const { highlight, highlightColour } = settings.recording

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="text-[13px] font-medium text-text">Show what is being used</span>
          <span className="text-xs leading-relaxed text-text-muted">
            Rings the button as it is pressed and the field as it is typed into. Someone watching
            the finished video did not drive it, and a click they cannot see is a step they have
            to be told about.
          </span>
        </span>
        <Switch
          label="Show what is being used"
          checked={highlight}
          onChange={(next) => onPatch({ highlight: next })}
        />
      </div>

      {highlight && (
        <Field label="Highlight colour" hint="Pick one that stands out against what you are recording.">
          <div className="flex flex-wrap items-center gap-2">
            {HIGHLIGHT_COLOURS.map((colour) => (
              <button
                key={colour}
                type="button"
                aria-label={`Highlight ${colour}`}
                title={colour}
                onClick={() => onPatch({ highlightColour: colour })}
                className={cn(
                  'h-7 w-7 rounded-full border-2 p-0 transition-transform',
                  highlightColour.toLowerCase() === colour ? 'border-text scale-110' : 'border-border'
                )}
                style={{ background: colour }}
              />
            ))}
            <input
              type="color"
              aria-label="Pick a highlight colour"
              value={highlightColour}
              onChange={(event) => onPatch({ highlightColour: event.target.value })}
              className="h-7 w-9 cursor-pointer rounded border border-border bg-transparent p-0"
            />
          </div>
        </Field>
      )}
    </div>
  )
}

/**
 * What this machine can and cannot do.
 *
 * A check that passes has nothing to tell anyone, so a list of five green rows is five rows of
 * decoration — it takes up the place where a real problem would have to be noticed. Everything
 * working collapses to a single line; anything that needs attention is what the panel shows.
 */
function SystemSection({ checks }: { checks: ReadinessCheck[] }): JSX.Element {
  const [showAll, setShowAll] = useState(false)

  if (checks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="md" label="Checking this machine" />
      </div>
    )
  }

  const unready = checks.filter((check) => !check.ready)
  const ready = checks.filter((check) => check.ready)
  const allWell = unready.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {allWell ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
            <span className="flex items-center gap-2.5">
              <CheckCircle2 size={14} className="shrink-0 text-success" aria-hidden="true" />
              <span className="text-[13px] text-text">Everything Talkie needs is available</span>
            </span>
            <Disclosure open={showAll} onToggle={() => setShowAll(!showAll)}>
              {showAll ? 'Hide the checks' : 'Show the checks'}
            </Disclosure>
          </div>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-text-muted">
              {unready.some((check) => check.required)
                ? 'Something Talkie needs is missing. What is marked in red has to be fixed before that part will work.'
                : 'Everything required is available. These are optional, and only affect what they say.'}
            </p>
            <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
              {unready.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
            {ready.length > 0 && (
              <Disclosure open={showAll} onToggle={() => setShowAll(!showAll)}>
                {showAll
                  ? 'Hide what is working'
                  : `${ready.length} other ${ready.length === 1 ? 'check is' : 'checks are'} fine`}
              </Disclosure>
            )}
          </>
        )}

        {showAll && (
          <div className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {(allWell ? checks : ready).map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        )}
      </div>

      <McpSection />
    </div>
  )
}

function Disclosure({
  open,
  onToggle,
  children
}: {
  open: boolean
  onToggle: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex shrink-0 items-center gap-1 self-start rounded border-0 bg-transparent px-0 py-0 text-[11px] text-text-muted hover:text-text"
    >
      <ChevronRight size={11} className={cn('transition-transform', open && 'rotate-90')} aria-hidden="true" />
      {children}
    </button>
  )
}

function CheckRow({ check }: { check: ReadinessCheck }): JSX.Element {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span
        className={cn(
          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
          check.ready ? 'bg-success' : check.required ? 'bg-danger' : 'bg-text-muted/40'
        )}
        aria-label={check.ready ? 'Ready' : check.required ? 'Not ready' : 'Optional, not set up'}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] text-text">{check.label}</span>
          {check.ready && check.detail && (
            <span className="text-[11px] text-text-muted">{check.detail}</span>
          )}
        </span>
        {!check.ready && (
          <>
            <span className="text-xs text-text-muted">{check.purpose}</span>
            {check.fix && (
              <span
                className={cn(
                  'text-xs leading-relaxed',
                  check.required ? 'text-danger' : 'text-text-muted'
                )}
              >
                {check.fix}
              </span>
            )}
          </>
        )}
      </span>
    </div>
  )
}

/** Voices for the language the app is running in come first; the rest follow alphabetically. */
