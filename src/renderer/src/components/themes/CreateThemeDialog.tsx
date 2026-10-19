import { useEffect, useRef, useState } from 'react'
import { Sparkles, TriangleAlert, Upload } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Spinner } from '../ui/Spinner'
import { themeClient, type GeneratedTheme, type ThemeDraft } from '../../api/projectClient'
import type { ThemeFontFile } from '../../../../main/themes/themeApi'

/**
 * Make a theme with AI from whatever is to hand — a website, a few words, a logo or a brand
 * guide. Any one is enough; more is better. What comes back is a draft for the editor, not a
 * saved theme: nothing reaches the library until someone has looked at it.
 */
export function CreateThemeDialog({
  onCreated,
  onCancel
}: {
  onCreated: (generated: GeneratedTheme) => void
  onCancel: () => void
}): JSX.Element {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // The company's own font files, used in place of whatever open fonts the theme would choose.
  const [fonts, setFonts] = useState<File[]>([])
  const fontPicker = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  // What it is doing now, asked for while it works — a site can take half a minute to read.
  const running = step !== null
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void themeClient.generateStatus().then((status) => {
        if (status.running && status.step) setStep(status.step)
      })
    }, 500)
    return () => clearInterval(timer)
  }, [running])

  const hasSomething = Boolean(url.trim() || description.trim() || file)

  async function create(): Promise<void> {
    setError(null)
    setStep('Starting…')
    try {
      const generated = await themeClient.generate({
        name: name.trim() || url.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'New theme',
        url: url.trim() || undefined,
        description: description.trim() || undefined,
        file: file ? { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name } : undefined
      })
      onCreated(fonts.length > 0 ? await withOwnFonts(generated, fonts) : generated)
    } catch (err) {
      // Electron prefixes an error thrown in main with where it came from; the reason is what matters.
      setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setStep(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-text-muted">
        Give any of these. Talkie reads the real colours, fonts and logo, your AI provider in Settings → AI
        chooses how to use them, and every colour is checked for readability. You see the theme before it
        is saved.
      </p>

      <Field label="Theme name">
        <Input aria-label="Theme name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme" />
      </Field>
      <Field label="Website">
        <Input aria-label="Website" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="acme.com" />
      </Field>
      <Field label="Describe it">
        <Textarea
          aria-label="Describe it"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Payments for small businesses. Calm and trustworthy; navy and green."
          className="min-h-16"
        />
      </Field>
      <Field label="Logo or brand guide">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => picker.current?.click()}>
            <Upload size={14} />
            {file ? 'Choose another' : 'Choose file…'}
          </Button>
          <span className="truncate text-[12px] text-text-muted">{file?.name ?? 'An image, or a PDF of the brand guidelines'}</span>
          <input
            ref={picker}
            type="file"
            aria-label="Logo or brand guide"
            accept=".svg,.png,.jpg,.jpeg,.webp,.pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </Field>

      <Field label="Company fonts (optional)">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => fontPicker.current?.click()}>
              <Upload size={14} />
              {fonts.length > 0 ? 'Choose others' : 'Choose font files…'}
            </Button>
            <span className="truncate text-[12px] text-text-muted">
              {fonts.length > 0 ? fonts.map((font) => font.name).join(', ') : '.otf, .ttf, .woff or .woff2 — every weight you use'}
            </span>
            <input
              ref={fontPicker}
              type="file"
              multiple
              aria-label="Company fonts"
              accept=".woff2,.woff,.ttf,.otf"
              className="hidden"
              onChange={(e) => setFonts(Array.from(e.target.files ?? []))}
            />
          </div>
          <span className="text-[11px] leading-relaxed text-text-muted">
            Used instead of the fonts Talkie would pick. One family is used throughout; with two, the first is for
            headings and the second for body text.
          </span>
        </div>
      </Field>

      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-[12px] leading-relaxed text-danger">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        {step && (
          <span className="mr-auto flex items-center gap-2 text-[12px] text-text-muted">
            <Spinner size="sm" label="Making the theme" />
            {step}
          </span>
        )}
        <Button variant="ghost" onClick={onCancel} disabled={step !== null}>
          Cancel
        </Button>
        <Button onClick={() => void create()} disabled={!hasSomething || step !== null}>
          <Sparkles size={14} />
          Create theme
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-text">{label}</span>
      {children}
    </div>
  )
}

/**
 * The theme as made, with the company's own fonts in place of the ones chosen for it: each file is
 * saved beside the draft and read for its family, one family serves both roles, and with two the
 * first heads and the second sets the body.
 */
async function withOwnFonts(generated: GeneratedTheme, files: File[]): Promise<GeneratedTheme> {
  const target = { stagingDir: generated.stagingDir }
  const added: ThemeFontFile[] = []
  for (const file of files) added.push(await themeClient.addFont(target, file.name, new Uint8Array(await file.arrayBuffer())))
  const families = [...new Set(added.map((face) => face.family))]
  const choice = (family: string): ThemeDraft['fonts']['heading'] => ({
    family,
    source: 'user',
    files: added.filter((face) => face.family === family).map((face) => face.file)
  })
  const heading = choice(families[0])
  const body = families[1] ? choice(families[1]) : heading
  const notes = generated.draft.provenance?.notes ?? []
  return {
    ...generated,
    draft: {
      ...generated.draft,
      fonts: { heading, body },
      ...(generated.draft.provenance
        ? { provenance: { ...generated.draft.provenance, notes: [...notes, `Uses your own fonts: ${families.join(' and ')}.`] } }
        : {})
    }
  }
}
