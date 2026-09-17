import { homedir } from 'os'
import { readSettings } from '../settings/settingsStore'
import { narrationProvider } from './providerRegistry'
import type { CleanAction } from './cleanActionLog'

/**
 * Where the demo stops being about one thing and starts being about another.
 *
 * Cutting on a clock keeps the words in step with the picture, but it is blind to what is being
 * said: a boundary can land halfway through one explanation, leaving a scene that is the tail of
 * one subject and the head of the next. Nothing downstream can recover from that — the narration
 * for that scene has two things to introduce and one breath to do it in.
 *
 * The action log is the one record of what the session was actually doing, and a model reading
 * it can see what a clock cannot: that three clicks and a navigation belong together, and that
 * the next one starts something else. It is asked for those moments and they become the
 * strongest candidates the splitter has.
 *
 * Everything here is best-effort. A project with no model behind it, a provider that is not set
 * up, a request that fails or comes back as prose — all of them mean no topic breaks, and the
 * recording is cut on the clock exactly as before. A recording must never fail to import
 * because a model was unreachable.
 */

/** Below this there is not enough of a session for the question to mean anything. */
const MIN_ACTIONS = 4

/** Long enough to be worth asking about; shorter recordings are one subject by definition. */
const MIN_SECONDS = 20

/**
 * How long the model gets before the clock decides on its own.
 *
 * This sits between the person pressing stop and their recording appearing on the timeline, so
 * it is the one model call in the app that something is visibly waiting on. A local model on a
 * cold start, or a provider that accepts the connection and then says nothing, would otherwise
 * hold the import open indefinitely for a refinement it is fine to do without.
 */
const GIVE_UP_AFTER_MS = 20_000

export function buildTopicBreakPrompt(actions: CleanAction[], totalSeconds: number): string {
  return [
    `Below is what happened during a ${totalSeconds.toFixed(0)}-second screen recording of a`,
    'software demo, each line timed in seconds from the start.',
    '',
    ...actions.map((action) => `[${action.atSeconds.toFixed(1)}] ${action.label}`),
    '',
    'The recording is about to be cut into scenes, and each scene gets its own piece of spoken',
    'narration. A scene must be about one thing: if a cut lands in the middle of an explanation,',
    'the scene after it has to introduce a subject that is already half told.',
    '',
    'Give me the moments where the demo stops doing one thing and starts doing another — a new',
    'part of the product, a new task, a change of subject someone narrating would pause at.',
    '',
    'Rules:',
    '- One number per line, in seconds, and nothing else. No words, no explanation.',
    '- The moment the new subject starts, not where the old one trailed off.',
    '- Only real changes of subject. Clicking through steps of the same task is one subject.',
    `- Nothing before 5 or after ${Math.max(0, totalSeconds - 5).toFixed(0)}.`,
    '- If the whole recording is one subject, reply with nothing at all.'
  ].join('\n')
}

/**
 * Read the answer back as moments.
 *
 * Deliberately forgiving about what comes back — a bare number on each line is what was asked
 * for, but a model that adds a bullet or a unit has still answered the question. Anything with
 * no number in it is dropped rather than treated as a failure, because one stray line of
 * commentary should not throw away the moments either side of it.
 */
export function parseTopicBreaks(answer: string, totalSeconds: number): number[] {
  const seconds = new Set<number>()

  for (const line of answer.split('\n')) {
    const match = /(\d+(?:\.\d+)?)/.exec(line.trim())
    if (!match) continue
    const at = Number(match[1])
    // A model that answers in milliseconds, or invents a moment past the end, has not given a
    // usable answer for that line.
    if (at > 0 && at < totalSeconds) seconds.add(Math.round(at * 10) / 10)
  }

  return [...seconds].sort((first, second) => first - second)
}

/** The moments the subject changes, in milliseconds, or none when nothing can answer. */
export async function findTopicBreaks(
  actions: CleanAction[],
  totalSeconds: number,
  baseDir: string = homedir()
): Promise<number[]> {
  if (actions.length < MIN_ACTIONS || totalSeconds < MIN_SECONDS) return []

  try {
    const provider = narrationProvider(readSettings(baseDir).narration.provider)
    // The built-in provider writes from a template and has no model to ask.
    if (!provider.complete) return []
    if (!(await provider.isAvailable()).available) return []

    const answer = await withinTimeout(provider.complete(buildTopicBreakPrompt(actions, totalSeconds)))
    if (answer === null) return []
    return parseTopicBreaks(answer, totalSeconds).map((at) => Math.round(at * 1000))
  } catch (err) {
    // The recording is already on disk and about to go on the timeline. Losing the subject
    // boundaries costs a better set of cuts; failing here would cost the whole import.
    console.error('Could not work out where the demo changes subject:', err)
    return []
  }
}

/** The answer, or null if it did not arrive in time. */
async function withinTimeout(answer: Promise<string>): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      answer,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), GIVE_UP_AFTER_MS)
      })
    ])
  } finally {
    // The losing promise is left running either way; this only stops the timer holding the
    // process open once the answer has won.
    clearTimeout(timer)
  }
}
