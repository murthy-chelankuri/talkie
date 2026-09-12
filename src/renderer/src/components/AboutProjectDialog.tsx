import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ProjectContext } from '../api/projectClient'
import { Button } from './ui/Button'
import { IconButton } from './ui/IconButton'
import { Input } from './ui/Input'
import { Textarea } from './ui/Textarea'

/**
 * What the model knows about this project before it writes a word of it.
 *
 * Four questions, not a form: each one changes the writing in a way the user can predict, and
 * the placeholders are written as answers rather than as hints, because the hardest part of a
 * box like this is knowing what belongs in it. Someone who fills in only the first has already
 * got most of the benefit — which is why it is first and why the rest can stay empty.
 */
export function AboutProjectDialog({
  projectName,
  context,
  onSave,
  onClose
}: {
  projectName: string
  context: ProjectContext
  onSave: (context: ProjectContext) => Promise<void> | void
  onClose: () => void
}): JSX.Element {
  const [draft, setDraft] = useState<ProjectContext>(context)
  const [saving, setSaving] = useState(false)

  const rules = draft.neverSay

  function setRule(index: number, value: string): void {
    setDraft((d) => ({ ...d, neverSay: d.neverSay.map((rule, i) => (i === index ? value : rule)) }))
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      // Blank rows are how a list like this is left, not something to store and match against.
      await onSave({ ...draft, neverSay: draft.neverSay.map((r) => r.trim()).filter(Boolean) })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div
        role="dialog"
        aria-label="About this project"
        className="flex max-h-full w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-xl"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="font-serif text-lg text-text">About this project</h2>
          <span className="truncate text-[11px] text-text-muted">{projectName}</span>
          <IconButton aria-label="Close" onClick={onClose} className="ml-auto">
            <X size={16} />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
          <p className="text-xs leading-relaxed text-text-muted">
            Everything written here is given to the model before it drafts narration, writes a
            slide or rewrites a line. Without it, it can only describe what moved on screen.
          </p>

          <Field
            label="What this project is about"
            hint="The product, what it does, and the words it uses for its own parts. This one does the most work."
          >
            <Textarea
              aria-label="What this project is about"
              value={draft.background}
              onChange={(event) => setDraft((d) => ({ ...d, background: event.target.value }))}
              placeholder={
                'Talkie records a browser session with no sound, then writes and speaks the narration over it.\nThe strip at the bottom is the timeline; each piece on it is a clip.\nCall it a walkthrough, not a video.'
              }
              className="min-h-[7rem] resize-y leading-relaxed"
            />
          </Field>

          <Field label="Who is watching" hint="Decides what can be assumed and what has to be explained.">
            <Input
              aria-label="Who is watching"
              value={draft.audience}
              onChange={(event) => setDraft((d) => ({ ...d, audience: event.target.value }))}
              placeholder="Developers deciding whether to try it"
            />
          </Field>

          <Field label="How it should sound" hint="A sentence is enough.">
            <Input
              aria-label="How it should sound"
              value={draft.tone}
              onChange={(event) => setDraft((d) => ({ ...d, tone: event.target.value }))}
              placeholder="Plain and unhurried. No marketing language, no exclamation marks."
            />
          </Field>

          <Field
            label="Never say"
            hint="Checked after every draft, not only asked for — anything that slips through is flagged on the clip."
          >
            <div className="flex flex-col gap-2">
              {rules.map((rule, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <Input
                    aria-label={`Never say ${index + 1}`}
                    value={rule}
                    onChange={(event) => setRule(index, event.target.value)}
                    placeholder="pricing"
                    className="flex-1"
                  />
                  <IconButton
                    aria-label={`Remove rule ${index + 1}`}
                    onClick={() =>
                      setDraft((d) => ({ ...d, neverSay: d.neverSay.filter((_, i) => i !== index) }))
                    }
                  >
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, neverSay: [...d.neverSay, ''] }))}
                className="flex items-center gap-1 self-start rounded border-0 bg-transparent px-0 py-0 text-[11px] text-accent hover:underline"
              >
                <Plus size={11} />
                {rules.length === 0 ? 'Add something it must never say' : 'Add another'}
              </button>
            </div>
          </Field>
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: JSX.Element
}): JSX.Element {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-text">{label}</span>
      <span className="text-[11px] leading-relaxed text-text-muted">{hint}</span>
      {children}
    </label>
  )
}
