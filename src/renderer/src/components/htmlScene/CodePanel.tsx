import { useEffect, useRef } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { javascript } from '@codemirror/lang-javascript'

function languageFor(path: string) {
  if (/\.css$/i.test(path)) return css()
  if (/\.(m?js|json)$/i.test(path)) return javascript()
  return html()
}

/** Colours from the app's own tokens, so the editor sits in the window in either theme. */
const look = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, monospace' },
  '.cm-gutters': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text-muted)', borderRight: '1px solid var(--color-border)' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' }
})

/**
 * One file of a scene, in CodeMirror. A new file — another tab — is a new editor: each keeps its
 * own undo, which is what anyone switching between index.html and style.css expects.
 */
export function CodePanel({ path, value, onChange }: { path: string; value: string; onChange: (text: string) => void }): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    if (!host.current) return
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageFor(path),
          look,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current(update.state.doc.toString())
          })
        ]
      })
    })
    return () => view.current?.destroy()
    // A new editor per file; the text of the open one is the editor's own from then on.
  }, [path])

  return <div ref={host} aria-label={`Code of ${path}`} className="h-full min-h-0 overflow-hidden" />
}
