import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, ImageUp, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { cn } from '../../lib/cn'
import { contrastRatio } from '../../../../main/themes/contrast'
import { ThemePreview } from './ThemePreview'
import { themeClient, type ThemeDraft, type ThemeTarget, type VariantId } from '../../api/projectClient'

const VARIANTS: Array<{ id: VariantId; label: string; hint: string }> = [
  { id: 'brand', label: 'Brand', hint: 'Opening and section slides, on the brand colour' },
  { id: 'light', label: 'Light', hint: 'Slides that explain' },
  { id: 'dark', label: 'Dark', hint: 'Slides that set a scene' }
]

/** WCAG's floor for each, which is also what the AI's drafts are fixed to. See contrast.ts. */
const MINIMUM = { heading: 3, body: 4.5, accent: 3 } as const

/**
 * Edit a theme, with the video it makes playing beside the controls.
 *
 * Every colour is shown with whether it can be read on its background, because the commonest
 * way a brand palette fails on a slide — a pale grey for body text — is invisible in a swatch
 * and obvious in a video nobody can read.
 */
export function ThemeEditor({
  initial,
  themeId,
  stagingDir,
  onDone
}: {
  initial: ThemeDraft
  /** A saved theme being changed. */
  themeId?: string
  /** A theme made by AI, not yet saved, whose files wait here. */
  stagingDir?: string
  onDone: () => void | Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState<ThemeDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<{ id: string; name: string }[] | null>(null)
  const target: ThemeTarget = themeId ? { themeId } : stagingDir ? { stagingDir } : null

  const setVariant = (id: VariantId, role: 'background' | 'heading' | 'body' | 'accent', value: string): void =>
    setDraft((d) => ({ ...d, variants: { ...d.variants, [id]: { ...d.variants[id], [role]: value } } }))

  async function addFile(kind: 'logo' | 'font', file: File, role?: 'heading' | 'body'): Promise<void> {
    setError(null)
    try {
      const path = await themeClient.addAsset(target, kind, file.name, new Uint8Array(await file.arrayBuffer()))
      if (kind === 'logo') {
        setDraft((d) => ({ ...d, logo: { corner: 'bottom-right', showOn: { recordings: true, slides: true }, ...d.logo, file: path } }))
      } else if (role) {
        setDraft((d) => {
          const current = d.fonts[role]
          // The person's own files replace a downloaded stand-in rather than joining it.
          const files = current.source === 'user' ? [...current.files, path] : [path]
          return { ...d, fonts: { ...d.fonts, [role]: { ...current, source: 'user', files } } }
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      if (themeId) await themeClient.update(themeId, draft)
      else await themeClient.create(draft, stagingDir)
      await onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove(): Promise<void> {
    if (!themeId) return
    if (confirmingDelete === null) {
      setConfirmingDelete(await themeClient.usage(themeId))
      return
    }
    await themeClient.remove(themeId)
    await onDone()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={() => void onDone()}>
          <ArrowLeft size={14} />
          Themes
        </Button>
        <span className="truncate text-[13px] text-text-muted">{themeId ? 'Editing' : 'New theme — not saved yet'}</span>
      </div>

      <ThemePreview draft={draft} target={target} />

      {draft.provenance && draft.provenance.notes.length > 0 && (
        <section aria-label="What was changed" className="flex flex-col gap-1 rounded-lg border border-border bg-bg p-3">
          <span className="text-[12px] font-medium text-text">
            Made from {draft.provenance.from.join(', ') || 'your description'}. Worth knowing:
          </span>
          {draft.provenance.notes.map((note) => (
            <span key={note} className="text-[11px] leading-relaxed text-text-muted">
              {note}
            </span>
          ))}
        </section>
      )}

      <Group title="Who it is for">
        <div className="grid grid-cols-2 gap-2">
          <Labelled label="Theme name">
            <Input aria-label="Theme name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
          </Labelled>
          <Labelled label="Company">
            <Input aria-label="Company" value={draft.company} onChange={(e) => setDraft((d) => ({ ...d, company: e.target.value }))} />
          </Labelled>
          <Labelled label="Tagline, on the closing card">
            <Input aria-label="Tagline" value={draft.tagline} onChange={(e) => setDraft((d) => ({ ...d, tagline: e.target.value }))} />
          </Labelled>
          <Labelled label="Website, on the closing card">
            <Input aria-label="Website" value={draft.website} onChange={(e) => setDraft((d) => ({ ...d, website: e.target.value }))} />
          </Labelled>
        </div>
      </Group>

      <Group title="Colours">
        {VARIANTS.map((variant) => {
          const colours = draft.variants[variant.id]
          return (
            <div key={variant.id} className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <span className="text-[12px] text-text">
                {variant.label} <span className="text-text-muted">— {variant.hint}</span>
              </span>
              <div className="grid grid-cols-4 gap-2">
                <ColourField label={`${variant.label} background`} value={colours.background} onChange={(v) => setVariant(variant.id, 'background', v)} />
                {(['heading', 'body', 'accent'] as const).map((role) => (
                  <ColourField
                    key={role}
                    label={`${variant.label} ${role}`}
                    value={colours[role]}
                    onChange={(v) => setVariant(variant.id, role, v)}
                    readable={contrastRatio(colours[role], colours.background) >= MINIMUM[role]}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </Group>

      <Group title="Type">
        <div className="grid grid-cols-2 gap-2">
          {(['heading', 'body'] as const).map((role) => (
            <FontField
              key={role}
              role={role}
              family={draft.fonts[role].family}
              source={draft.fonts[role].source}
              fileCount={draft.fonts[role].files.length}
              onFamily={(family) => setDraft((d) => ({ ...d, fonts: { ...d.fonts, [role]: { ...d.fonts[role], family } } }))}
              onFile={(file) => void addFile('font', file, role)}
              canAdd={target !== null}
            />
          ))}
        </div>
      </Group>

      <Group title="Logo">
        <div className="flex flex-wrap items-end gap-3">
          <FilePicker label={draft.logo ? 'Replace logo' : 'Choose logo'} accept=".svg,.png,.jpg,.jpeg,.webp" icon={<ImageUp size={14} />} onFile={(file) => void addFile('logo', file)} disabled={target === null} />
          {draft.logo && (
            <>
              <Labelled label="Corner">
                <select
                  aria-label="Logo corner"
                  value={draft.logo.corner}
                  onChange={(e) => setDraft((d) => ({ ...d, logo: d.logo && { ...d.logo, corner: e.target.value as NonNullable<ThemeDraft['logo']>['corner'] } }))}
                  className="rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] text-text"
                >
                  <option value="top-left">Top left</option>
                  <option value="top-right">Top right</option>
                  <option value="bottom-left">Bottom left</option>
                  <option value="bottom-right">Bottom right</option>
                </select>
              </Labelled>
              {(['recordings', 'slides'] as const).map((where) => (
                <label key={where} className="flex items-center gap-1.5 text-[12px] text-text">
                  <input
                    type="checkbox"
                    checked={draft.logo?.showOn[where] ?? false}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, logo: d.logo && { ...d.logo, showOn: { ...d.logo.showOn, [where]: e.target.checked } } }))
                    }
                  />
                  On {where}
                </label>
              ))}
            </>
          )}
        </div>
      </Group>

      <Group title="Overlays">
        <div className="grid grid-cols-2 gap-2">
          <ColourField
            label="Click highlight"
            value={draft.overlays.highlight}
            onChange={(highlight) => setDraft((d) => ({ ...d, overlays: { ...d.overlays, highlight } }))}
            hint="Drawn while recording, so it applies to new recordings only."
          />
          <Labelled label="Caption bar">
            <select
              aria-label="Caption bar"
              value={draft.overlays.caption}
              onChange={(e) => setDraft((d) => ({ ...d, overlays: { ...d.overlays, caption: e.target.value as VariantId } }))}
              className="rounded-md border border-border bg-surface px-1.5 py-1 text-[12px] text-text"
            >
              {VARIANTS.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.label}
                </option>
              ))}
            </select>
          </Labelled>
        </div>
      </Group>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {confirmingDelete && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/[0.06] p-3 text-[12px] leading-relaxed text-text">
          {confirmingDelete.length === 0
            ? 'No project uses this theme. Delete it?'
            : `${confirmingDelete.map((p) => p.name).join(', ')} ${confirmingDelete.length === 1 ? 'uses' : 'use'} this theme, and will go back to Talkie’s own look. Delete it?`}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        {themeId && (
          <Button variant="ghost" onClick={() => void remove()} className="text-danger">
            <Trash2 size={14} />
            {confirmingDelete ? 'Yes, delete it' : 'Delete theme'}
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => void onDone()}>
          Cancel
        </Button>
        <Button disabled={saving || !draft.name.trim()} onClick={() => void save()}>
          <Check size={14} />
          {saving ? 'Saving…' : 'Save theme'}
        </Button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-text">{title}</h3>
      {children}
    </section>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-text-muted">{label}</span>
      {children}
    </div>
  )
}

function ColourField({
  label,
  value,
  onChange,
  readable,
  hint
}: {
  label: string
  value: string
  onChange: (value: string) => void
  /** Whether it reads on its background; absent for a colour that is not set against one. */
  readable?: boolean
  hint?: string
}): JSX.Element {
  // Typed text is kept while it is half a colour; a change from the picker replaces it.
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="flex flex-col gap-1">
      <span className="truncate text-[11px] capitalize text-text-muted">{label.split(' ').slice(-1)[0]}</span>
      <div className="flex items-center gap-1">
        <input
          type="color"
          aria-label={`${label} colour`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
        />
        <Input
          aria-label={label}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase())
          }}
          className="h-7 min-w-0 px-1.5 font-mono text-[11px]"
        />
      </div>
      {readable !== undefined && (
        <span className={cn('text-[10px]', readable ? 'text-text-muted' : 'text-danger')}>
          {readable ? 'Readable' : 'Hard to read'}
        </span>
      )}
      {hint && <span className="text-[10px] leading-snug text-text-muted">{hint}</span>}
    </div>
  )
}

function FontField({
  role,
  family,
  source,
  fileCount,
  onFamily,
  onFile,
  canAdd
}: {
  role: 'heading' | 'body'
  family: string
  source: string
  fileCount: number
  onFamily: (family: string) => void
  onFile: (file: File) => void
  canAdd: boolean
}): JSX.Element {
  const where =
    source === 'user'
      ? `Your files (${fileCount})`
      : source === 'google'
        ? 'Open font, downloaded'
        : 'Built into Talkie'
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <span className="text-[11px] capitalize text-text-muted">{role}</span>
      <Input aria-label={`${role} font`} value={family} onChange={(e) => onFamily(e.target.value)} />
      <span className="text-[10px] text-text-muted">{where}</span>
      <FilePicker label="Add font file" accept=".woff2,.woff,.ttf,.otf" icon={<Upload size={13} />} onFile={onFile} disabled={!canAdd} />
    </div>
  )
}

function FilePicker({
  label,
  accept,
  icon,
  onFile,
  disabled
}: {
  label: string
  accept: string
  icon: ReactNode
  onFile: (file: File) => void
  disabled?: boolean
}): JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <Button variant="ghost" onClick={() => input.current?.click()} disabled={disabled}>
        {icon}
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accept}
        aria-label={label}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFile(file)
          e.target.value = ''
        }}
      />
    </>
  )
}
