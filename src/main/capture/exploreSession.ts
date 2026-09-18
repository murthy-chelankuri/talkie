import { homedir } from 'os'
import type { Page } from 'playwright'
import { readSettings } from '../settings/settingsStore'
import { narrationProvider } from '../agent/providerRegistry'
import { openProject } from '../project/projectApi'
import { describeProjectContext } from '../project/projectContext'
import { READ_PAGE_SCRIPT } from './readPage'
import { safeCandidates, type Candidate } from './safeToClick'
import { authWall, type Wall } from './authWall'
import type { CapturedField } from './redact'

/**
 * Walk an app on its own and record what it finds.
 *
 * Driving a demo by hand is the thing most likely to stop someone making one at all, and the
 * pieces to do it without them were already here: a real browser under Playwright, and a
 * provider that answers questions. What it could not do was decide what to look at next.
 *
 * This is a walkthrough, not a crawl. An exhaustive sweep of every reachable page makes a long,
 * shapeless video that nobody watches — a demo needs a route through the app the way someone
 * showing you round would take one, and that is a judgement only the model can make.
 *
 * It looks and does not touch. Everything it may click is decided by safeToClick.ts, which
 * allows navigation and refuses everything else: this runs unattended against what may well be
 * a production system, and a recording is the worst possible place to find out that a button
 * did something. Nothing here types, and nothing here submits a form.
 */

/** Long enough to see an app, short enough that a wrong turn is not the whole video. */
export const MAX_STEPS = 24

/** A ceiling on the whole walk, for an app that keeps offering somewhere new to go. */
export const MAX_SECONDS = 240

/** Time on each screen before moving on, so there is something to narrate over. */
export const DWELL_MS = 2600

/**
 * How long to hold at a sign-in wall before giving up on the person coming back.
 *
 * Generous on purpose: signing in can mean fetching a phone, opening an authenticator, or
 * finding a password. The recording is running the whole time, which costs nothing but a
 * stretch of footage the user can trim.
 */
export const WAIT_FOR_USER_MS = 5 * 60 * 1000

/** How often to look at the page while waiting, which only has to beat human reaction time. */
const CHECK_EVERY_MS = 1500

/** What the model may ask for next. */
export type Move = { kind: 'click'; index: number } | { kind: 'scroll' } | { kind: 'done' }

export interface ExploreProgress {
  step: number
  url: string
  /** What it decided to do, in words, for the toolbar to show. */
  doing: string
  /**
   * Set while the walk is stopped and the person has to do something.
   *
   * The toolbar shows this differently: a recorder that is quietly waiting looks exactly like a
   * recorder that has hung, and the difference matters when the answer is "type your password".
   */
  needsYou?: boolean
}

/** Why the walk finished, which decides whether the recording should finish with it. */
export type ExploreEnding = 'done' | 'nowhere' | 'budget' | 'stopped' | 'waited-too-long'

export interface ExploreResult {
  visited: string[]
  ending: ExploreEnding
}

export class NoExploreProviderError extends Error {
  constructor(label: string) {
    super(
      `${label} has no model behind it, so it cannot explore an app by itself. ` +
        'Choose a narration provider with a model in Settings, or drive the recording yourself.'
    )
    this.name = 'NoExploreProviderError'
  }
}

export interface PageReading {
  url: string
  origin: string
  title: string
  heading: string
  text: string
  /** The page's input fields. Never typed into — this is how a sign-in wall is recognised. */
  fields: CapturedField[]
  candidates: Candidate[]
}

/** What the page says about itself, with everything unsafe already taken out. */
export async function readPage(page: Page): Promise<PageReading> {
  const raw = (await page.evaluate(READ_PAGE_SCRIPT)) as PageReading
  return { ...raw, fields: raw.fields ?? [], candidates: safeCandidates(raw.candidates ?? [], raw.origin) }
}

/**
 * Hold while the person signs in, and carry on when they have.
 *
 * Nothing here touches the page. It watches for the wall to go, which is the only signal that
 * does not depend on guessing how a particular app's login is laid out — an email-then-password
 * form, a single-sign-on round trip and a code from an authenticator all end the same way, with
 * a page that is no longer asking.
 *
 * Returns the reading on the other side, or null if the person never came back.
 */
export async function waitForSignIn(
  page: Page,
  wall: Wall,
  options: { waitMs?: number; onProgress?: (progress: ExploreProgress) => void; shouldStop?: () => boolean } = {}
): Promise<PageReading | null> {
  const until = Date.now() + (options.waitMs ?? WAIT_FOR_USER_MS)
  let announced = ''

  while (Date.now() < until) {
    if (options.shouldStop?.()) return null

    const left = Math.ceil((until - Date.now()) / 60000)
    const doing = `Waiting for you to enter ${wall?.asking ?? 'your details'} — ${left} min left`
    // Re-sent only when the wording changes, so the toolbar is not rewritten twice a second.
    if (doing !== announced) {
      announced = doing
      options.onProgress?.({ step: -1, url: page.url(), doing, needsYou: true })
    }

    await page.waitForTimeout(CHECK_EVERY_MS).catch(() => undefined)

    try {
      const reading = await readPage(page)
      if (!authWall(reading) && reading.candidates.length > 0) return reading
    } catch {
      // Mid-navigation, which is what signing in looks like. Look again shortly.
    }
  }

  return null
}

export function buildMovePrompt(
  reading: PageReading,
  visited: string[],
  options: { stepsLeft: number; projectName: string; context?: string }
): string {
  return [
    `You are recording a demo of ${options.projectName} by walking through the app yourself.`,
    ...(options.context ? [options.context, ''] : ['']),
    `You are on: ${reading.title || reading.url}`,
    reading.heading ? `The heading says: ${reading.heading}` : '',
    reading.text ? `What is on screen: ${reading.text}` : '',
    '',
    visited.length > 0 ? `Already shown: ${visited.join(' → ')}` : 'This is the first screen.',
    `About ${options.stepsLeft} steps left.`,
    '',
    'You can go to one of these:',
    ...reading.candidates.map((candidate, index) => `  ${index + 1}. ${candidate.label}`),
    '',
    'Pick the next thing to show someone seeing this app for the first time. Take a route',
    'through it the way you would if you were showing them round: the main thing it does first,',
    'then the parts that make sense after that. Do not go back somewhere already shown.',
    '',
    'Answer with exactly one of:',
    '  CLICK <number>   — go to that one',
    '  SCROLL           — there is more worth seeing further down this page',
    '  DONE             — the app has been shown well enough',
    'and nothing else.'
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Read the answer as a move.
 *
 * A model that explains itself before answering has still answered, so the last thing it says
 * that looks like a move is the one taken. Anything unreadable ends the walk rather than
 * guessing: a wrong click here is a real action against a real app.
 */
export function parseMove(answer: string, candidateCount: number): Move {
  let move: Move | null = null

  for (const line of answer.split('\n')) {
    const said = line.trim().toUpperCase()
    const click = /\bCLICK\s+(\d+)/.exec(said)
    if (click) {
      const index = Number(click[1]) - 1
      if (index >= 0 && index < candidateCount) move = { kind: 'click', index }
      continue
    }
    if (/\bSCROLL\b/.test(said)) move = { kind: 'scroll' }
    else if (/\bDONE\b/.test(said)) move = { kind: 'done' }
  }

  return move ?? { kind: 'done' }
}

export interface ExploreOptions {
  maxSteps?: number
  maxSeconds?: number
  dwellMs?: number
  onProgress?: (progress: ExploreProgress) => void
  /** Stops the walk early, for a user who has seen enough. */
  shouldStop?: () => boolean
}

/**
 * Drive the page until the app has been shown or the budget runs out.
 *
 * The recording is already running when this is called and keeps running after it returns, so a
 * walk that ends early still produces everything up to that point. Every way out — the model
 * saying it is done, a page with nowhere safe to go, a step that fails, the caller stopping it —
 * leaves a usable recording rather than an exception.
 */
export async function exploreApp(
  page: Page,
  projectId: string,
  options: ExploreOptions = {},
  baseDir: string = homedir()
): Promise<ExploreResult> {
  const settings = readSettings(baseDir)
  const provider = narrationProvider(settings.narration.provider)
  if (!provider.complete) throw new NoExploreProviderError(provider.label)

  const maxSteps = options.maxSteps ?? MAX_STEPS
  const maxSeconds = options.maxSeconds ?? MAX_SECONDS
  const dwellMs = options.dwellMs ?? DWELL_MS
  const until = Date.now() + maxSeconds * 1000

  const project = projectFacts(projectId, baseDir)
  const visited: string[] = []
  const done = (ending: ExploreEnding): ExploreResult => ({ visited, ending })

  for (let step = 0; step < maxSteps; step += 1) {
    if (options.shouldStop?.()) return done('stopped')
    if (Date.now() > until) return done('budget')

    // Whatever the last move did, let the screen settle and give the narration something to
    // talk over before deciding again.
    await page.waitForTimeout(dwellMs).catch(() => undefined)

    let reading: PageReading
    try {
      reading = await readPage(page)
    } catch {
      // A page mid-navigation cannot be read; the next turn of the loop will find it settled.
      continue
    }

    // A login, or a code from an authenticator. The walk cannot get past either — it never
    // types — but the browser is real and on screen, so the person can, and the recording keeps
    // running while they do. Without this the walk would find nothing safe to click, decide the
    // app was finished, and leave a recording of a login screen with no explanation.
    const wall = authWall(reading)
    if (wall) {
      const past = await waitForSignIn(page, wall, {
        onProgress: options.onProgress,
        shouldStop: options.shouldStop
      })
      if (!past) return done(options.shouldStop?.() ? 'stopped' : 'waited-too-long')
      reading = past
      options.onProgress?.({ step, url: reading.url, doing: 'Signed in — carrying on' })
    }

    if (reading.candidates.length === 0) return done('nowhere')

    const answer = await provider
      .complete(
        buildMovePrompt(reading, visited, {
          stepsLeft: maxSteps - step,
          projectName: project.name,
          context: project.context
        })
      )
      .catch(() => 'DONE')

    const move = parseMove(answer, reading.candidates.length)
    if (move.kind === 'done') return done('done')

    if (move.kind === 'scroll') {
      options.onProgress?.({ step, url: reading.url, doing: 'Looking further down the page' })
      await page.mouse.wheel(0, 900).catch(() => undefined)
      continue
    }

    const chosen = reading.candidates[move.index]
    options.onProgress?.({ step, url: reading.url, doing: `Opening "${chosen.label}"` })
    visited.push(chosen.label)

    try {
      // The selector is the attribute the reading script just stamped on, so it cannot go stale
      // against a page that has not changed since.
      await page.click(chosen.selector, { timeout: 5000 })
    } catch {
      // Something moved, or the click went nowhere. The next reading describes wherever the
      // page actually is, which is a better basis than retrying a selector that already failed.
      continue
    }
  }

  return done('budget')
}

function projectFacts(projectId: string, baseDir: string): { name: string; context?: string } {
  try {
    const project = openProject(projectId, baseDir)
    const context = describeProjectContext(project.context)
    return { name: project.name, context: context.length > 0 ? context.join('\n') : undefined }
  } catch {
    return { name: 'this app' }
  }
}
