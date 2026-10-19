import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Copy, ImageUp, Trash2, TriangleAlert, Upload, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { cn } from '../../lib/cn'
import { contrastRatio } from '../../../../main/themes/contrast'
import { ThemePreview } from './ThemePreview'
import { themeClient, type Theme, type ThemeDraft, type ThemeTarget, type VariantId } from '../../api/projectClient'
import { isBuiltinThemeId } from '../../../../main/themes/builtinThemes'
import { BUILTIN_FONTS } from '../../../../main/themes/schema'
import { describeFace } from '../../../../main/themes/fontFace'
import type { ThemeFontFile } from '../../../../main/themes/themeApi'

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
  onDone,
  onDuplicate
}: {
  initial: ThemeDraft
  /** A saved theme being changed. */
  themeId?: string
  /** A theme made by AI, not yet saved, whose files wait here. */
  stagingDir?: string
  onDone: () => void | Promise<void>
  /** Opens the copy, which is the only way to change a built-in theme. */
  onDuplicate?: (copy: Theme) => void
}): JSX.Element {
  const builtIn = themeId !== undefined && isBuiltinThemeId(themeId)
  const [draft, setDraft] = useState<ThemeDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<{ id: string; name: string }[] | null>(null)
  const target: ThemeTarget = themeId ? { themeId } : stagingDir ? { stagingDir } : null
  // What each of the person's font files is — family, face, weight — read from the files.
  const [faces, setFaces] = useState<Record<'heading' | 'body', ThemeFontFile[]>>({ heading: [], body: [] })
  const headingFiles = draft.fonts.heading.source === 'user' ? draft.fonts.heading.files : []
  const bodyFiles = draft.fonts.body.source === 'user' ? draft.fonts.body.files : []
  useEffect(() => {
    let cancelled = false
    void Promise.all([themeClient.fontFiles(target, headingFiles), themeClient.fontFiles(target, bodyFiles)]).then(([heading, body]) => {
      if (!cancelled) setFaces({ heading, body })
    })
    return () => {
      cancelled = true
    }
    // The file lists, by value: the target is fixed for as long as the editor is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headingFiles.join('|'), bodyFiles.join('|')])

  /**
   * The person's own font files for one role, read as they arrive. The first sets the family by
   * the name inside it — nobody should have to know a font's exact internal name to use it.
   */
  async function addFonts(role: 'heading' | 'body', files: File[]): Promise<void> {
    setError(null)
    const added: ThemeFontFile[] = []
    for (const file of files) {
      try {
        added.push(await themeClient.addFont(target, file.name, new Uint8Array(await file.arrayBuffer())))
      } catch (err) {
        setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
      }
    }
    if (added.length === 0) return
    setDraft((d) => {
      const current = d.fonts[role]
      // The person's own files replace a downloaded or built-in font rather than joining it.
      const mine = current.source === 'user'
      const files = [...(mine ? current.files : []), ...added.map((face) => face.file)].filter((file, at, all) => all.indexOf(file) === at)
      return { ...d, fonts: { ...d.fonts, [role]: { family: mine ? current.family : added[0].family, source: 'user', files } } }
    })
  }

  function removeFont(role: 'heading' | 'body', file: string): void {
    setDraft((d) => {
      const current = d.fonts[role]
      const files = current.files.filter((each) => each !== file)
      // With the last file gone the role goes back to Talkie's own type, never to a name with no font.
      const fallback = { family: role === 'heading' ? BUILTIN_FONTS.serif : BUILTIN_FONTS.sans, source: 'builtin' as const, files: [] }
      return { ...d, fonts: { ...d.fonts, [role]: files.length > 0 ? { ...current, files } : fallback } }
    })
  }

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

  async function duplicate(): Promise<void> {
    if (!themeId || !onDuplicate) return
    setError(null)
    try {
      onDuplicate(await themeClient.duplicate(themeId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
        <span className="truncate text-[13px] text-text-muted">
          {builtIn
            ? 'Built into Talkie — it cannot be changed or deleted. Duplicate it to make it your own.'
            : themeId
              ? 'Editing'
              : 'New theme — not saved yet'}
        </span>
      </div>

      <ThemePreview draft={draft} target={target} />

      {draft.provenance && draft.provenance.notes.length > 0 && (
        <section aria-label="What was changed" className="flex flex-col gap-1 rounded-lg bg-raised p-3">
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

      {/* Shown rather than hidden for a built-in theme: what it is made of is worth seeing before
          copying it, and a read-only form says so better than a different screen would. */}
      <fieldset disabled={builtIn} className="contents">
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

      {/* Before the colours: a company's typeface is half of what makes a video look like theirs,
          and it was a button below every colour, easy to miss. */}
      <Group title="Fonts">
        <div className="grid grid-cols-2 gap-2">
          {(['heading', 'body'] as const).map((role) => (
            <FontField
              key={role}
              role={role}
              family={draft.fonts[role].family}
              source={draft.fonts[role].source}
              faces={faces[role]}
              onFamily={(family) => setDraft((d) => ({ ...d, fonts: { ...d.fonts, [role]: { ...d.fonts[role], family } } }))}
              onFiles={(files) => void addFonts(role, files)}
              onRemove={(file) => removeFont(role, file)}
              onUseForOther={
                draft.fonts[role].source === 'user' && draft.fonts[other(role)].family !== draft.fonts[role].family
                  ? () => setDraft((d) => ({ ...d, fonts: { ...d.fonts, [other(role)]: { ...d.fonts[role] } } }))
                  : undefined
              }
              canAdd={target !== null}
            />
          ))}
        </div>
      </Group>

      <Group title="Colours">
        {VARIANTS.map((variant) => {
          const colours = draft.variants[variant.id]
          return (
            <div key={variant.id} className="flex flex-col gap-2 rounded-xl bg-raised p-3">
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
                  className="rounded-md bg-raised px-1.5 py-1 text-[12px] text-text"
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
              className="rounded-md bg-raised px-1.5 py-1 text-[12px] text-text"
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

      </fieldset>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {confirmingDelete && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/6 p-3 text-[12px] leading-relaxed text-text">
          {confirmingDelete.length === 0
            ? 'No project uses this theme. Delete it?'
            : `${confirmingDelete.map((p) => p.name).join(', ')} ${confirmingDelete.length === 1 ? 'uses' : 'use'} this theme, and will go back to Talkie’s own look. Delete it?`}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        {themeId && !builtIn && (
          <Button variant="ghost" onClick={() => void remove()} className="text-danger">
            <Trash2 size={14} />
            {confirmingDelete ? 'Yes, delete it' : 'Delete theme'}
          </Button>
        )}
        <span className="flex-1" />
        <Button variant="ghost" onClick={() => void onDone()}>
          {builtIn ? 'Back' : 'Cancel'}
        </Button>
        {themeId && onDuplicate && (
          <Button variant={builtIn ? 'primary' : 'ghost'} onClick={() => void duplicate()}>
            <Copy size={14} />
            Duplicate
          </Button>
        )}
        {!builtIn && (
          <Button disabled={saving || !draft.name.trim()} onClick={() => void save()}>
            <Check size={14} />
            {saving ? 'Saving…' : 'Save theme'}
          </Button>
        )}
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
          className="h-7 w-8 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0"
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

const other = (role: 'heading' | 'body'): 'heading' | 'body' => (role === 'heading' ? 'body' : 'heading')

/**
 * One role's typeface: the company's own files, or Talkie's.
 *
 * The family names itself from the first file, every file is listed as the face it is — so a
 * missing bold is plain to see — and the name is set in the font itself, which is the only real
 * check that the right font arrived.
 */
function FontField({
  role,
  family,
  source,
  faces,
  onFamily,
  onFiles,
  onRemove,
  onUseForOther,
  canAdd
}: {
  role: 'heading' | 'body'
  family: string
  source: string
  faces: ThemeFontFile[]
  onFamily: (family: string) => void
  onFiles: (files: File[]) => void
  onRemove: (file: string) => void
  onUseForOther?: () => void
  canAdd: boolean
}): JSX.Element {
  const where = source === 'user' ? 'Your company’s font' : source === 'google' ? 'Open font, downloaded' : 'Built into Talkie'
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-raised p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] capitalize text-text">{role}</span>
        <span className="text-[10px] text-text-muted">{where}</span>
      </div>
      <p className="truncate text-[22px] leading-tight text-text" style={{ fontFamily: `"${family.replace(/"/g, '')}", system-ui` }} aria-hidden="true">
        Aa — The quick brown fox
      </p>
      <Input aria-label={`${role} font`} value={family} onChange={(e) => onFamily(e.target.value)} />
      {faces.length > 0 && (
        <ul aria-label={`${role} font files`} className="flex flex-col gap-0.5">
          {faces.map((face) => (
            <li key={face.file} className="flex items-center gap-2 text-[11px] text-text-muted">
              <span
                className="min-w-0 flex-1 truncate text-text"
                style={{ fontFamily: `"${family.replace(/"/g, '')}", system-ui`, fontWeight: face.variable ? undefined : face.weight, fontStyle: face.italic ? 'italic' : 'normal' }}
              >
                {face.variable ? `${face.face} · every weight` : describeFace(face.weight, face.italic)}
              </span>
              <span className="max-w-[45%] truncate">{face.file.replace(/^fonts\//, '')}</span>
              <button
                type="button"
                aria-label={`Remove ${face.file.replace(/^fonts\//, '')}`}
                onClick={() => onRemove(face.file)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-text-muted hover:text-danger"
              >
                <X size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <FilePicker
        label={source === 'user' ? 'Add more font files' : 'Upload your font files'}
        accept=".woff2,.woff,.ttf,.otf"
        icon={<Upload size={13} />}
        onFiles={onFiles}
        multiple
        disabled={!canAdd}
      />
      <span className="text-[10px] leading-relaxed text-text-muted">
        .otf, .ttf, .woff or .woff2 — add each weight you use, such as Regular and Bold.
      </span>
      {onUseForOther && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onUseForOther}>
          Use for {other(role)} too
        </Button>
      )}
    </div>
  )
}

function FilePicker({
  label,
  accept,
  icon,
  onFile,
  onFiles,
  multiple,
  disabled
}: {
  label: string
  accept: string
  icon: ReactNode
  onFile?: (file: File) => void
  /** With `multiple`: every file chosen at once — a font family comes as several. */
  onFiles?: (files: File[]) => void
  multiple?: boolean
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
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (onFiles && files.length > 0) onFiles(files)
          else if (files[0]) onFile?.(files[0])
          e.target.value = ''
        }}
      />
    </>
  )
}
