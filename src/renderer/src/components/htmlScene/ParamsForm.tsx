import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { cn } from '../../lib/cn'

/**
 * A scene's named values as a form, so "Q3" becomes "Q4" without anyone reading the code.
 *
 * Shaped by the values themselves, at any depth: a line of text is a field and a long one a box;
 * a list is rows that can be added to, taken from and put in order; a list of things — a chart's
 * bars, a flow's steps — is a card for each with its own fields. Lists of words used to be one
 * box of JSON, which nobody who is not a programmer could edit.
 */
export function ParamsForm({
  params,
  onChange
}: {
  params: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}): JSX.Element {
  const entries = Object.entries(params)
  if (entries.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-text-muted">
        This scene has no values to change. Change it with Ask AI, or in its code — it reads them from talkie.params.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      {entries.map(([key, value]) => (
        <ValueField key={key} label={labelFor(key)} name={key} value={value} onChange={(next) => onChange({ ...params, [key]: next })} />
      ))}
    </div>
  )
}

/** "subtitle" → "Subtitle", "beforeAfter" → "Before after", "chart_title" → "Chart title". */
export function labelFor(key: string): string {
  const words = key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** One item's name in a list: "Point 2", "Step 3". */
function itemName(label: string, index: number): string {
  const singular = label.replace(/ies$/i, 'y').replace(/s$/i, '')
  return `${singular || 'Item'} ${index + 1}`
}

function ValueField({ label, name, value, onChange }: { label: string; name: string; value: unknown; onChange: (next: unknown) => void }): JSX.Element {
  if (Array.isArray(value)) return <ListField label={label} name={name} items={value} onChange={onChange} />
  if (isRecord(value)) {
    return (
      <fieldset className="flex flex-col gap-3 rounded-lg border border-border p-3">
        <legend className="px-1 text-[12px] font-medium text-text">{label}</legend>
        {Object.entries(value).map(([key, inner]) => (
          <ValueField key={key} label={labelFor(key)} name={`${name} ${key}`} value={inner} onChange={(next) => onChange({ ...value, [key]: next })} />
        ))}
      </fieldset>
    )
  }
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text">{label}</span>
      <Plain name={label} value={value} onChange={onChange} />
    </label>
  )
}

function Plain({ name, value, onChange }: { name: string; value: unknown; onChange: (next: unknown) => void }): JSX.Element {
  if (typeof value === 'number') {
    return <Input aria-label={name} type="number" value={String(value)} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} className="w-full" />
  }
  if (typeof value === 'boolean') {
    return <input aria-label={name} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 self-start accent-[var(--color-accent-fill)]" />
  }
  if (typeof value === 'string' || value === null || value === undefined) {
    const text = value ?? ''
    // A sentence or code wants room; a word or a number does not.
    return text.length > 60 || text.includes('\n') ? (
      <Textarea aria-label={name} value={text} onChange={(e) => onChange(e.target.value)} className={cn('min-h-[4.5rem] w-full text-[13px]', text.includes('\n') && 'font-mono text-[12px]')} />
    ) : (
      <Input aria-label={name} value={text} onChange={(e) => onChange(e.target.value)} className="w-full" />
    )
  }
  return <JsonField name={name} value={value} onChange={onChange} />
}

/** Rows to add to, take from and reorder; a list of things gets a card per thing. */
function ListField({ label, name, items, onChange }: { label: string; name: string; items: unknown[]; onChange: (next: unknown[]) => void }): JSX.Element {
  const set = (index: number, next: unknown): void => onChange(items.map((item, at) => (at === index ? next : item)))
  const move = (index: number, by: number): void => {
    const to = index + by
    if (to < 0 || to >= items.length) return
    const next = [...items]
    ;[next[index], next[to]] = [next[to], next[index]]
    onChange(next)
  }
  const cards = items.some((item) => isRecord(item) || Array.isArray(item))

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-text">{label}</span>
      {items.map((item, index) => {
        const named = itemName(label, index)
        const controls = (
          <span className="flex shrink-0 items-center">
            <RowButton label={`Move ${named} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp size={12} />
            </RowButton>
            <RowButton label={`Move ${named} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown size={12} />
            </RowButton>
            <RowButton label={`Remove ${named}`} onClick={() => onChange(items.filter((_, at) => at !== index))}>
              <X size={12} />
            </RowButton>
          </span>
        )
        return cards ? (
          <div key={index} className="flex flex-col gap-2 rounded-lg bg-raised p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-muted">{named}</span>
              {controls}
            </div>
            {isRecord(item) ? (
              Object.entries(item).map(([key, inner]) => (
                <ValueField key={key} label={labelFor(key)} name={`${named} ${key}`} value={inner} onChange={(next) => set(index, { ...item, [key]: next })} />
              ))
            ) : (
              <Plain name={named} value={item} onChange={(next) => set(index, next)} />
            )}
          </div>
        ) : (
          <div key={index} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <Plain name={named} value={item} onChange={(next) => set(index, next)} />
            </div>
            {controls}
          </div>
        )
      })}
      <button
        type="button"
        onClick={() => onChange([...items, blankLike(items[items.length - 1])])}
        className="flex items-center gap-1 self-start rounded-md border-0 bg-transparent px-1 py-0.5 text-[12px] text-accent hover:underline"
      >
        <Plus size={12} aria-hidden="true" />
        Add {itemName(label, items.length).replace(/ \d+$/, '').toLowerCase()}
      </button>
    </div>
  )
}

/** A new item shaped like the last: the same fields, emptied, so it fits what the page expects. */
export function blankLike(example: unknown): unknown {
  if (typeof example === 'number') return 0
  if (typeof example === 'boolean') return false
  if (Array.isArray(example)) return example.map(blankLike)
  if (isRecord(example)) return Object.fromEntries(Object.entries(example).map(([key, value]) => [key, blankLike(value)]))
  return ''
}

function RowButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: JSX.Element }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded border-0 bg-transparent p-0 text-text-muted hover:text-text disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function JsonField({ name, value, onChange }: { name: string; value: unknown; onChange: (next: unknown) => void }): JSX.Element {
  const [json, setJson] = useState(() => JSON.stringify(value, null, 2))
  const [broken, setBroken] = useState(false)
  return (
    <>
      <Textarea
        aria-label={name}
        value={json}
        onChange={(e) => {
          setJson(e.target.value)
          try {
            onChange(JSON.parse(e.target.value))
            setBroken(false)
          } catch {
            setBroken(true)
          }
        }}
        className="min-h-[4.5rem] font-mono text-[11px]"
      />
      {broken && <span className="text-[11px] text-danger">Not valid JSON yet — the last valid value is kept.</span>}
    </>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
