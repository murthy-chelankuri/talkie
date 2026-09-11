import { homedir } from 'os'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { findProjectDir } from '../project/paths'
import { openProject, readTimeline, readTranscript, setDraftedNarration } from '../project/projectApi'
import { readSettings } from '../settings/settingsStore'
import { narrationProvider } from './providerRegistry'
import { gatherClipEvidence } from './clipEvidence'
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
    const text = await provider.draft({
      evidence,
      projectName: projectName(projectId, baseDir),
      clipIndex: index + 1,
      clipCount: timeline.length,
      previousNarration: narrationOf(projectId, timeline[index - 1]?.id, baseDir)
    })

    if (!text.trim()) {
      return record(
        projectId,
        { timelineItemId, providerId: provider.id, status: 'failed', reason: 'The provider returned no words.' },
        startedAt,
        baseDir
      )
    }

    setDraftedNarration(projectId, timelineItemId, text, baseDir)
    return record(projectId, { timelineItemId, providerId: provider.id, status: 'drafted', text }, startedAt, baseDir)
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

function projectName(projectId: string, baseDir: string): string {
  try {
    return openProject(projectId, baseDir).name
  } catch {
    return 'this demo'
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
