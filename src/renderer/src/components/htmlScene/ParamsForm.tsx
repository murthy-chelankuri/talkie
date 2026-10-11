import { useState } from 'react'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'

/**
 * A scene's named values as a form, so "Q3" becomes "Q4" without anyone reading the code. Plain
 * values get plain fields; lists of numbers a comma-separated line; anything else its JSON.
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
    return <p className="text-[11px] leading-relaxed text-text-muted">This scene has no values to change. Its code reads them from talkie.params.</p>
  }
  const set = (key: string, value: unknown): void => onChange({ ...params, [key]: value })

  return (
    <div className="flex flex-col gap-2">
      {entries.map(([key, value]) => (
        <label key={key} className="flex flex-col gap-1">
          <span className="text-[11px] text-text-muted">{key}</span>
          <Field name={key} value={value} onChange={(next) => set(key, next)} />
        </label>
      ))}
    </div>
  )
}

function Field({ name, value, onChange }: { name: string; value: unknown; onChange: (next: unknown) => void }): JSX.Element {
  const [json, setJson] = useState(() => JSON.stringify(value, null, 2))
  const [broken, setBroken] = useState(false)

  if (typeof value === 'string') return <Input aria-label={name} value={value} onChange={(e) => onChange(e.target.value)} />
  if (typeof value === 'number') {
    return <Input aria-label={name} type="number" value={String(value)} onChange={(e) => onChange(Number(e.target.value))} />
  }
  if (typeof value === 'boolean') {
    return <input aria-label={name} type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="self-start" />
  }
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
    return (
      <Input
        aria-label={name}
        value={value.join(', ')}
        onChange={(e) => onChange(e.target.value.split(',').map((part) => Number(part.trim())).filter((n) => !Number.isNaN(n)))}
      />
    )
  }
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
