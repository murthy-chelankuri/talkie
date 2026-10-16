import { homedir } from 'os'
import { narrationProvider } from '../agent/providerRegistry'
import { readSettings } from '../settings/settingsStore'
import { describeProjectContext, type ProjectContext } from '../project/projectContext'
import { HTML_SCENE_GUIDE } from './guide'
import { LONG_ANSWER } from '../agent/narrationProvider'

/**
 * An HTML scene written by the configured model, from a description or as a change to one that
 * exists. The same guide agents read over MCP, so both are held to the same rules.
 */
export interface HtmlSceneRequest {
  /** What the person asked for, in their words. */
  instruction: string
  /** The scene's files as they stand, when changing one. */
  current?: Record<string, string>
  title?: string
  projectName: string
  context?: ProjectContext
  /** What the check found last time, so a second attempt can fix it. */
  problems?: string[]
  /** How long the scene runs. Without it a page paced for five seconds was made for five minutes. */
  seconds?: number
}

export type HtmlSceneWritten =
  | { status: 'written'; title: string; files: Record<string, string> }
  | { status: 'failed'; reason: string }

export function buildHtmlScenePrompt(request: HtmlSceneRequest): string {
  const lines = [
    HTML_SCENE_GUIDE,
    '',
    `You are writing one scene of a product demo called "${request.projectName}".`,
    ...describeProjectContext(request.context),
    ''
  ]
  if (request.current) {
    lines.push('The scene as it stands:', '')
    for (const [path, text] of Object.entries(request.current)) lines.push(`=== ${path} ===`, text, '')
    lines.push(`Change it like this: ${request.instruction}`)
  } else {
    lines.push(`What the scene should show: ${request.instruction}`)
  }
  if (request.seconds) {
    lines.push(
      '',
      `The scene runs for ${describeLength(request.seconds)} (talkie.duration). Pace it across the whole of that — ` +
        'reveal, move and change things all the way through, rather than finishing in the first seconds and standing still.'
    )
  }
  if (request.problems?.length) {
    lines.push('', 'The last version had these problems; fix every one:', ...request.problems.map((problem) => `- ${problem}`))
  }
  lines.push(
    '',
    'Reply with the files and nothing else, in exactly this form:',
    'TITLE: a few words naming the scene',
    '=== index.html ===',
    '<the whole file>',
    'and another "=== path ===" section for each other file. Always include index.html in full.'
  )
  return lines.join('\n')
}

export function parseHtmlScene(reply: string, fallbackTitle = 'HTML scene'): HtmlSceneWritten {
  const text = reply.replace(/^```\w*\n?|\n?```$/gm, '')
  const title = /^TITLE:\s*(.+)$/m.exec(text)?.[1]?.trim() || fallbackTitle
  const files: Record<string, string> = {}
  const sections = text.split(/^=== (.+?) ===$/m)
  for (let i = 1; i + 1 < sections.length; i += 2) files[sections[i].trim()] = sections[i + 1].replace(/^\n/, '').replace(/\n+$/, '\n')
  if (!files['index.html']?.trim()) return { status: 'failed', reason: 'The model did not write an index.html.' }
  return { status: 'written', title, files }
}

export async function writeHtmlScene(request: HtmlSceneRequest, baseDir: string = homedir()): Promise<HtmlSceneWritten> {
  const provider = narrationProvider(readSettings(baseDir).narration.provider)
  if (!provider.complete) {
    return { status: 'failed', reason: `${provider.label} cannot write a scene. Choose a model in Settings, under AI.` }
  }
  const availability = await provider.isAvailable()
  if (!availability.available) return { status: 'failed', reason: availability.reason ?? `${provider.label} is not available.` }
  try {
    return parseHtmlScene(await provider.complete(buildHtmlScenePrompt(request), LONG_ANSWER), request.title)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Said as what happened and what to do, rather than as an aborted request.
    if (/timed? ?out|timeout|aborted|did not finish|killed|ETIMEDOUT/i.test(message)) {
      return {
        status: 'failed',
        reason: `${provider.label} did not finish writing the scene within ${LONG_ANSWER.timeoutMs! / 60_000} minutes. ` +
          'Describe less in one scene, or split it into several — each scene shows one idea.'
      }
    }
    return { status: 'failed', reason: message }
  }
}

/** "5 minutes", "1 minute 30 seconds", "12 seconds". */
export function describeLength(seconds: number): string {
  const whole = Math.round(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const part = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (minutes === 0) return part(rest, 'second')
  return rest === 0 ? part(minutes, 'minute') : `${part(minutes, 'minute')} ${part(rest, 'second')}`
}
