import { homedir } from 'os'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import { openProject, readTimeline, readTranscript, setDraftedNarration } from '../project/projectApi'
import { findForbiddenTerms, type ProjectContext } from '../project/projectContext'
import { readSettings } from '../settings/settingsStore'
import { narrationProvider } from './providerRegistry'
import { gatherClipEvidence } from './clipEvidence'
import { cleanDraft } from './narrationProvider'
import { beatsToText, parseBeats } from '../transcript/narrationBeats'
import type { NarrationProviderId } from '../settings/schema'

export interface DraftOptions {
  /** Replace narration the user wrote. Only ever set from an explicit redraft. */
  force?: boolean
}

export interface DraftResult {
  timelineItemId: string
  providerId: NarrationProviderId
  status: 'drafted' | 'skipped' | 'failed'
  text?: string
  reason?: string
  /**
   * Words the project said never to use that turned up anyway. The draft is still saved — it may
   * be most of the way there — but the user is told rather than left to find it themselves.
   */
  forbidden?: string[]
}

/**
 * Draft the narration for one clip.
 *
 * Words the user wrote are never replaced unless they ask: a segment counts as theirs the
 * moment it is edited or narrated, and only an agent-written `draft` is overwritten silently.
 */
export async function draftNarrationForItem(
  projectId: string,
  timelineItemId: string,
  options: DraftOptions = {},
  baseDir: string = homedir()
): Promise<DraftResult> {
  const settings = readSettings(baseDir)
  const provider = narrationProvider(settings.narration.provider)
  const startedAt = Date.now()

  const existing = readTranscript(projectId, baseDir).find(
    (segment) => segment.timelineItemId === timelineItemId
  )
  if (existing && existing.status !== 'draft' && existing.text.trim() && !options.force) {
    return skip(projectId, timelineItemId, provider.id, 'This clip already has narration you wrote.', baseDir)
  }

  const availability = await provider.isAvailable()
  if (!availability.available) {
    return record(
      projectId,
      { timelineItemId, providerId: provider.id, status: 'failed', reason: availability.reason },
      startedAt,
      baseDir
    )
  }

  const evidence = await gatherClipEvidence(projectId, timelineItemId, baseDir)
  try {
    const timeline = readTimeline(projectId, baseDir)
    const index = timeline.findIndex((item) => item.id === timelineItemId)
    const project = projectFacts(projectId, baseDir)
    const text = await provider.draft({
      evidence,
      projectName: project.name,
      clipIndex: index + 1,
      clipCount: timeline.length,
      previousNarration: narrationOf(projectId, timeline[index - 1]?.id, baseDir),
      context: project.context,
      // How many words fit is a question about the voice this will be read in.
      pace: settings.speech.pace
    })

    if (!text.trim()) {
      return record(
        projectId,
        { timelineItemId, providerId: provider.id, status: 'failed', reason: 'The provider returned no words.' },
        startedAt,
        baseDir
      )
    }

    // Timed lines where the model gave them; a draft with none is still good narration and is
    // kept as the one beat every take used to be. See narrationBeats.ts.
    const beats = parseBeats(text)
    const prose = beats.length > 0 ? beatsToText(beats) : cleanDraft(text)
    setDraftedNarration(projectId, timelineItemId, prose, beats, baseDir)

    // A prompt is a request, not a guarantee — so what came back is checked against the rules
    // rather than assumed to follow them.
    const forbidden = findForbiddenTerms(text, project.context?.neverSay ?? [])

    return record(
      projectId,
      {
        timelineItemId,
        providerId: provider.id,
        status: 'drafted',
        text,
        ...(forbidden.length > 0 ? { forbidden } : {})
      },
      startedAt,
      baseDir
    )
  } catch (err) {
    return record(
      projectId,
      {
        timelineItemId,
        providerId: provider.id,
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err)
      },
      startedAt,
      baseDir
    )
  } finally {
    // Sampled frames are temporary whatever the outcome.
    evidence.cleanup?.()
  }
}

/**
 * Draft every clip that still needs narration. Clips are done one at a time rather than at
 * once: a local model would thrash, and a paid one would bill for work the user may cancel.
 */
export async function draftNarrationForProject(
  projectId: string,
  options: DraftOptions = {},
  baseDir: string = homedir()
): Promise<DraftResult[]> {
  const results: DraftResult[] = []
  for (const item of readTimeline(projectId, baseDir)) {
    results.push(await draftNarrationForItem(projectId, item.id, options, baseDir))
  }
  return results
}

/** What was said over the clip before this one, so a draft can pick up rather than restart. */
function narrationOf(projectId: string, timelineItemId: string | undefined, baseDir: string): string | undefined {
  if (!timelineItemId) return undefined
  return readTranscript(projectId, baseDir).find((segment) => segment.timelineItemId === timelineItemId)?.text
}

/**
 * The project's name and context, or sensible stand-ins.
 *
 * A project.json that cannot be read is not a reason to refuse to write narration — the clip,
 * its action log and its frames are all still there, and they are most of what the model uses.
 */
function projectFacts(projectId: string, baseDir: string): { name: string; context?: ProjectContext } {
  try {
    const project = openProject(projectId, baseDir)
    return { name: project.name, context: project.context }
  } catch {
    return { name: 'this demo' }
  }
}

function skip(
  projectId: string,
  timelineItemId: string,
  providerId: NarrationProviderId,
  reason: string,
  baseDir: string
): DraftResult {
  return record(projectId, { timelineItemId, providerId, status: 'skipped', reason }, Date.now(), baseDir)
}

/**
 * Keep a record of what the agent did, in the project's own `agents/runs` folder. Drafting is
 * the one part of the app whose output is not reproducible, so it is the one part worth a log.
 */
function record(projectId: string, result: DraftResult, startedAt: number, baseDir: string): DraftResult {
  try {
    const dir = findProjectDir(projectId, baseDir)
    if (dir) {
      const runsDir = join(dir, 'agents', 'runs')
      mkdirSync(runsDir, { recursive: true })
      appendFileSync(
        join(runsDir, 'narration.jsonl'),
        `${JSON.stringify({
          at: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          timelineItemId: result.timelineItemId,
          provider: result.providerId,
          status: result.status,
          reason: result.reason,
          words: result.text ? result.text.trim().split(/\s+/).length : undefined
        })}\n`,
        'utf-8'
      )
    }
  } catch (err) {
    // Losing the log must never lose the narration.
    console.error(`Could not record the narration run for ${projectId}:`, err)
  }

  return result
}
