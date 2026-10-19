import { useState } from 'react'
import { LifeBuoy } from 'lucide-react'
import { settingsClient } from '../api/projectClient'
import { Button } from './ui/Button'
import { Textarea } from './ui/Textarea'
import { Working } from './ui/Working'

/**
 * Something not working: a report saved as a zip, and a GitHub issue opened to attach it to.
 *
 * Talkie sends nothing itself. The person writes what happened, reads the zip if they like, and
 * posts it — so what goes in has to be something they would be content to post: this copy of
 * Talkie and the Mac, never anything out of their projects, never a key.
 */
export function ReportProblem(): JSX.Element {
  const [description, setDescription] = useState('')
  const [state, setState] = useState<{ status: 'idle' | 'working' } | { status: 'saved'; path: string } | { status: 'failed'; message: string }>({
    status: 'idle'
  })

  async function report(): Promise<void> {
    setState({ status: 'working' })
    try {
      const outcome = await settingsClient.reportProblem(description)
      setState(outcome.status === 'saved' ? { status: 'saved', path: outcome.path } : { status: 'idle' })
    } catch (err) {
      setState({ status: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <section aria-label="Report a problem" className="flex flex-col gap-3 rounded-xl bg-raised p-4">
      <span className="flex items-center gap-2">
        <LifeBuoy size={13} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="text-[13px] font-medium text-text">Report a problem</span>
      </span>
      <p className="text-xs leading-relaxed text-text-muted">
        Talkie checks itself, speaks a test line, and saves a report with its versions, these checks, your settings without
        any keys, and its recent log. Nothing from your projects goes in — no narration, scenes or names. Then it opens a
        GitHub issue for you to attach the report to. Nothing is sent until you post it.
      </p>
      <Textarea
        aria-label="What went wrong"
        placeholder="What went wrong, and what were you doing? For example: narration over MCP fails with “Kokoro stopped unexpectedly”."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="min-h-20 text-[13px]"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" disabled={state.status === 'working'} onClick={() => void report()}>
          Save report and open GitHub
        </Button>
        {state.status === 'working' && <Working what="Checking Talkie" slowNote="speaking a test line" slowAfter={3} />}
        {state.status === 'saved' && (
          <span role="status" className="text-xs text-text-muted">
            Saved to {state.path}. Attach it to the issue that has opened in your browser.
          </span>
        )}
        {state.status === 'failed' && (
          <span role="alert" className="text-xs text-danger">
            Could not make the report: {state.message}
          </span>
        )}
      </div>
    </section>
  )
}
