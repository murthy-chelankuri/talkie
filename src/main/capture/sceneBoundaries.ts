import type { ActionLogEntry } from './actionLog'

/** A stretch of the stitched recording that becomes one clip on the timeline. */
export interface SceneWindow {
  /** Milliseconds into the stitched video where this scene starts. */
  fromMs: number
  durationMs: number
  /** What put a cut here. Kept for tests and for anyone reading a surprising split. */
  because: CutReason
}

export type CutReason = 'start' | 'page' | 'shot' | 'topic' | 'note' | 'navigation' | 'pause' | 'wait' | 'clock'

/**
 * How strong a reason to cut is, where two of them fall close together.
 *
 * A new tab is the clearest break there is — the person has moved somewhere else entirely. A
 * note they pressed during the recording is them saying so themselves, and a change of subject
 * is a model saying so on their behalf. A navigation is only the page changing under them, and
 * a wait is an inference from nothing happening.
 *
 * A video brought in from elsewhere has no log, only its picture and its sound. A shot changing is
 * whoever edited it saying a new thing starts, as plainly as a new tab; a pause in the speech is
 * where a sentence ended, worth landing on but no reason to cut on its own.
 */
const STRENGTH: Record<CutReason, number> = {
  start: 5,
  page: 4,
  shot: 4,
  topic: 3,
  note: 3,
  navigation: 1,
  pause: 1,
  wait: 0,
  clock: 0
}

/**
 * A break that means something, rather than one inferred from the shape of the log.
 *
 * These are taken the moment they arrive instead of being weighed against the beat: holding a
 * change of subject back to the clock is exactly how a scene ends up being half one thing and
 * half the next, which is the thing scenes exist to prevent.
 */
const DELIBERATE = STRENGTH.topic

/**
 * The shortest a scene may be.
 *
 * Below about this a cut every couple of seconds stops reading as structure and starts reading
 * as a fault, and there is no room for the beat of silence at each end that narration needs.
 */
export const MIN_SCENE_MS = 5000

/**
 * How often the words are put back in step with the picture.
 *
 * This is the whole point of cutting a session up. A scene is the unit narration is written,
 * read and fitted in, so its start is a moment the two are known to agree — and nothing that
 * goes slightly wrong inside one scene can still be wrong in the next. Every this often is
 * close enough that a take drifting by half a second has somewhere to correct itself before
 * anyone notices, and far enough apart that a viewer sees scenes rather than a stutter.
 */
export const TARGET_SCENE_MS = 15000

/**
 * How far off the beat a cut may land in order to fall on something that actually happened.
 *
 * Cutting to a fixed clock alone would put boundaries in the middle of a click or a page load.
 * Given the choice between the exact moment and a real event a few seconds either side, the
 * event wins: it is where the narration has a sentence boundary anyway.
 */
export const SNAP_MS = 5000

/** Nothing happening for this long is the screen waiting, which is where a scene can end. */
export const IDLE_GAP_MS = 4000

interface Candidate {
  atMs: number
  because: CutReason
}

/** The kinds of entry that are somebody doing something, rather than the page talking to itself. */
function isAction(entry: ActionLogEntry): boolean {
  return entry.type === 'click' || entry.type === 'navigation' || entry.type === 'input' || entry.type === 'annotation'
}

/**
 * Every moment in the recording that could reasonably start a new scene.
 *
 * All of these come from what was written down while recording, so a split lands on something
 * that actually happened rather than on a round number of seconds.
 */
export function cutCandidates(
  entries: ActionLogEntry[],
  pageChangesMs: number[] = [],
  topicBreaksMs: number[] = []
): Candidate[] {
  const candidates: Candidate[] = [
    ...pageChangesMs.map((atMs) => ({ atMs, because: 'page' as const })),
    ...topicBreaksMs.map((atMs) => ({ atMs, because: 'topic' as const }))
  ]
  const actions = entries.filter(isAction).sort((first, second) => first.t - second.t)

  for (const [index, entry] of actions.entries()) {
    if (entry.type === 'annotation') candidates.push({ atMs: entry.t, because: 'note' })
    else if (entry.type === 'navigation') candidates.push({ atMs: entry.t, because: 'navigation' })

    // The end of a wait, not its start: the pause belongs to the step that caused it. "I press
    // run, and it thinks for a moment" is one scene; the wait opening the next one would leave
    // it starting on a still screen with nothing to say about it.
    const next = actions[index + 1]
    if (next && next.t - entry.t >= IDLE_GAP_MS) candidates.push({ atMs: next.t, because: 'wait' })
  }

  return candidates.sort((first, second) => first.atMs - second.atMs)
}

/**
 * Cut the recording into scenes on a regular beat, landing each cut on something that happened.
 *
 * A session used to arrive as one clip however long it ran, with one take of narration read
 * over it. That take could only be in step with the picture at the moment it started: every
 * estimate that came out slightly long pushed everything after it later, and there was nowhere
 * for the error to stop. A scene is somewhere — the words are written, read and fitted against
 * one scene's own footage, so a take that ends half a second late ends half a second late once,
 * and the next scene starts in step again.
 *
 * That is why the cadence is a clock rather than a count of events: scenes have to come around
 * often enough to catch a drift while it is still small, whether or not the demo happened to do
 * anything interesting in the meantime. Where something did happen near the beat, the cut moves
 * to it — a boundary on a navigation or a lull is one the narration was going to break at
 * anyway. See TARGET_SCENE_MS and SNAP_MS.
 *
 * The clock is blind to what is being said, though, and a scene that is the tail of one subject
 * and the head of the next cannot be narrated well by anything. So where a model has read the
 * action log and said where the demo changes subject, those moments cut ahead of the beat
 * rather than being weighed against it. See topicBreaks.ts.
 *
 * The footage is not touched. Every scene points at the same stitched file and plays its own
 * stretch of it, so the split costs nothing to make and nothing to undo.
 */
export function planScenes(
  totalMs: number,
  entries: ActionLogEntry[],
  pageChangesMs: number[] = [],
  topicBreaksMs: number[] = [],
  options: { minSceneMs?: number; targetSceneMs?: number; snapMs?: number } = {}
): SceneWindow[] {
  const settings = {
    minSceneMs: options.minSceneMs ?? MIN_SCENE_MS,
    targetSceneMs: options.targetSceneMs ?? TARGET_SCENE_MS,
    snapMs: options.snapMs ?? SNAP_MS
  }

  return planFrom(cutCandidates(entries, pageChangesMs, topicBreaksMs), totalMs, settings)
}

/** Where something in a video's own picture and sound could start a scene, in milliseconds. */
export interface FootageCuts {
  /** The picture changing all at once: a cut made when the video was edited. */
  shotsMs: number[]
  /** The picture starting to move again after holding still. */
  stillsEndMs: number[]
  /** The middle of a pause in the speech. */
  pausesMs: number[]
}

/**
 * Cut a video made somewhere else into scenes, on the same beat a recording is cut to.
 *
 * It has no log of what happened, so what it shows and says stands in for one: a shot changing
 * is taken the way a new tab is, and the end of a still stretch the way a wait is — the pause
 * belongs to what caused it. A cut that lands in a pause in the speech lands between sentences.
 */
export function planFootageScenes(
  totalMs: number,
  cuts: FootageCuts,
  options: { minSceneMs?: number; targetSceneMs?: number; snapMs?: number } = {}
): SceneWindow[] {
  const candidates: Candidate[] = [
    ...cuts.shotsMs.map((atMs) => ({ atMs, because: 'shot' as const })),
    ...cuts.stillsEndMs.map((atMs) => ({ atMs, because: 'wait' as const })),
    ...cuts.pausesMs.map((atMs) => ({ atMs, because: 'pause' as const }))
  ]
  return planFrom(
    candidates.filter((candidate) => candidate.atMs > 0 && candidate.atMs < totalMs).sort((first, second) => first.atMs - second.atMs),
    totalMs,
    {
      minSceneMs: options.minSceneMs ?? MIN_SCENE_MS,
      targetSceneMs: options.targetSceneMs ?? TARGET_SCENE_MS,
      snapMs: options.snapMs ?? SNAP_MS
    }
  )
}

function planFrom(candidates: Candidate[], totalMs: number, settings: Cadence): SceneWindow[] {
  // Too short to hold two scenes is one scene, whatever happened during it.
  if (totalMs < settings.minSceneMs * 2) {
    return [{ fromMs: 0, durationMs: Math.max(1, totalMs), because: 'start' }]
  }
  return windowsFrom(chooseCuts(candidates, totalMs, settings), totalMs)
}

interface Cadence {
  minSceneMs: number
  targetSceneMs: number
  snapMs: number
}

/** Walk the recording a scene at a time, stopping while what is left is one scene's worth. */
function chooseCuts(candidates: Candidate[], totalMs: number, cadence: Cadence): Candidate[] {
  const cuts: Candidate[] = []
  let from = 0

  for (;;) {
    // What is left fits in one scene, unless something deliberate starts in it: a new tab or a
    // cut in an edit near the end is as much the start of something as one in the middle.
    const cut =
      totalMs - from > cadence.targetSceneMs + cadence.snapMs
        ? endOfScene(candidates, from, cadence)
        : deliberateIn(candidates, from, totalMs, cadence)
    // Never leave a last scene too short to be seen and spoken over; it joins this one instead.
    if (!cut || totalMs - cut.atMs < cadence.minSceneMs) break
    cuts.push(cut)
    from = cut.atMs
  }

  return cuts
}

/** The first deliberate break in the last stretch that leaves a whole scene either side of it. */
function deliberateIn(candidates: Candidate[], from: number, totalMs: number, cadence: Cadence): Candidate | undefined {
  return candidates.find(
    (candidate) =>
      STRENGTH[candidate.because] >= DELIBERATE &&
      candidate.atMs >= from + cadence.minSceneMs &&
      candidate.atMs <= totalMs - cadence.minSceneMs
  )
}

/**
 * Where the scene that began at `from` should end.
 *
 * A break the person made themselves — moving to another tab, or pressing a note on the
 * toolbar — is taken as soon as it arrives, because it is the start of something and waiting
 * for the beat would bury it mid-scene. Anything else is judged on how near the beat it falls,
 * and where nothing at all happened the clock decides.
 */
function endOfScene(candidates: Candidate[], from: number, cadence: Cadence): Candidate {
  const onBeat = from + cadence.targetSceneMs
  const inRange = candidates.filter(
    (candidate) => candidate.atMs >= from + cadence.minSceneMs && candidate.atMs <= onBeat + cadence.snapMs
  )

  const deliberate = inRange.filter((candidate) => STRENGTH[candidate.because] >= DELIBERATE)
  if (deliberate.length > 0) return deliberate[0]

  if (inRange.length === 0) return { atMs: onBeat, because: 'clock' }
  return inRange.reduce((best, candidate) =>
    Math.abs(candidate.atMs - onBeat) < Math.abs(best.atMs - onBeat) ? candidate : best
  )
}

function windowsFrom(cuts: Candidate[], totalMs: number): SceneWindow[] {
  const scenes: SceneWindow[] = []
  let from = 0
  let because: CutReason = 'start'

  for (const cut of cuts) {
    scenes.push({ fromMs: from, durationMs: cut.atMs - from, because })
    from = cut.atMs
    because = cut.because
  }

  scenes.push({ fromMs: from, durationMs: Math.max(1, totalMs - from), because })
  return scenes.filter((scene) => scene.durationMs > 0)
}
