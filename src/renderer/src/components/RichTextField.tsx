import { useEffect, useRef, useState } from 'react'
import { Bold, Italic, Underline, Palette, RemoveFormatting } from 'lucide-react'
import { sanitiseRichText } from '../../../main/project/timeline/richText'
import { cn } from '../lib/cn'

/** A few colours that sit well on a slide, plus whatever the user picks themselves. */
const SWATCHES = ['#7ab5f0', '#b5d8f9', '#5eead4', '#c4b5fd', '#f87171', '#ffffff', '#9aa3b4']

/**
 * A text field that keeps a little formatting.
 *
 * Built on contentEditable rather than on an editor library: the whole allowed vocabulary is
 * bold, italic, underline and colour, the output has to be markup the video renderer can be
 * handed directly, and a library would bring its own document model to convert to and from.
 * Everything typed or pasted is put through the same sanitiser the project stores.
 */
export function RichTextField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  multiline = false,
  className
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  ariaLabel: string
  multiline?: boolean
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState(false)

  // Written in only when it differs, or every keystroke would move the caret to the end.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) ref.current.innerHTML = value
  }, [value])

  function emit(): void {
    if (ref.current) onChange(sanitiseRichText(ref.current.innerHTML))
  }

  function apply(command: string, argument?: string): void {
    ref.current?.focus()
    // Without this, a colour comes back as <font color>, which is not markup a video renderer
    // should be handed — and which the sanitiser would rightly refuse.
    document.execCommand('styleWithCSS', false, 'true')
    // execCommand is the only way to style a selection inside contentEditable that every
    // browser still agrees on, deprecated or not — and this runs in one known browser.
    document.execCommand(command, false, argument)
    emit()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          'flex items-center gap-0.5 rounded-lg bg-raised p-1 transition-opacity',
          !focused && 'opacity-60'
        )}
      >
        <FormatButton label="Bold" onClick={() => apply('bold')}>
          <Bold size={13} />
        </FormatButton>
        <FormatButton label="Italic" onClick={() => apply('italic')}>
          <Italic size={13} />
        </FormatButton>
        <FormatButton label="Underline" onClick={() => apply('underline')}>
          <Underline size={13} />
        </FormatButton>

        <span className="mx-1 h-4 w-px bg-border" />

        <Palette size={12} className="mx-0.5 shrink-0 text-text-muted" aria-hidden="true" />
        {SWATCHES.map((colour) => (
          <button
            key={colour}
            type="button"
            aria-label={`Colour ${colour}`}
            title={colour}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => apply('foreColor', colour)}
            className="h-4 w-4 shrink-0 rounded-full border border-border p-0"
            style={{ background: colour }}
          />
        ))}
        <input
          type="color"
          aria-label="Pick a colour"
          title="Pick a colour"
          onChange={(event) => apply('foreColor', event.target.value)}
          className="h-5 w-6 cursor-pointer rounded-sm border border-border bg-transparent p-0"
        />

        <span className="mx-1 h-4 w-px bg-border" />

        <FormatButton label="Clear formatting" onClick={() => apply('removeFormat')}>
          <RemoveFormatting size={13} />
        </FormatButton>
      </div>

      <div
        ref={ref}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={() => {
          setFocused(false)
          emit()
        }}
        onFocus={() => setFocused(true)}
        onPaste={(event) => {
          // Pasting from anywhere else arrives as a document; only the words are wanted.
          event.preventDefault()
          const text = event.clipboardData.getData('text/plain')
          document.execCommand('insertText', false, multiline ? text : text.replace(/\n+/g, ' '))
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !multiline) event.preventDefault()
        }}
        className={cn(
          'min-h-10 rounded-md bg-raised px-2.5 py-2 text-[13px] text-text',
          'focus:outline-hidden focus:ring-1 focus:ring-inset focus:ring-accent',
          'empty:before:text-text-muted empty:before:content-[attr(data-placeholder)]',
          className
        )}
      />
    </div>
  )
}

function FormatButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: JSX.Element
}): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Without this the selection is lost before the command can be applied to it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-text-muted hover:bg-surface-hover hover:text-text"
    >
      {children}
    </button>
  )
}
