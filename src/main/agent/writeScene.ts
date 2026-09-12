import { homedir } from 'os'
import { readSettings } from '../settings/settingsStore'
import { narrationProvider } from './providerRegistry'
import { TextSceneDataSchema, DiagramSceneDataSchema } from '../project/timeline/schema'

export type SceneKind = 'scene' | 'diagram'

export interface SceneRequest {
  kind: SceneKind
  /** What the scene says now, if it says anything. Absent when starting from nothing. */
  current?: { title?: string; bullets?: string[]; source?: string }
  /** What the user asked for, in their words. */
  instruction: string
  projectName: string
}

export type SceneResult =
  | { status: 'written'; data: unknown }
  | { status: 'failed'; reason: string }

/**
 * Write or rewrite a scene from an instruction.
 *
 * The instruction is the user's, so this is a conversation rather than a generator: what the
 * scene says now is sent along with what they want changed, and the answer replaces it. That is
 * what makes "make it shorter" mean something the second time it is asked.
 */
export async function writeScene(request: SceneRequest, baseDir: string = homedir()): Promise<SceneResult> {
  const provider = narrationProvider(readSettings(baseDir).narration.provider)

  if (!provider.complete) {
    return {
      status: 'failed',
      reason: `${provider.label} cannot write a scene. Choose a model in Settings, under Narration.`
    }
  }

  const availability = await provider.isAvailable()
  if (!availability.available) {
    return { status: 'failed', reason: availability.reason ?? `${provider.label} is not available.` }
  }

  let answer: string
  try {
    answer = await provider.complete(buildScenePrompt(request))
  } catch (err) {
    return { status: 'failed', reason: err instanceof Error ? err.message : String(err) }
  }

  return parseScene(request.kind, answer)
}

export function buildScenePrompt(request: SceneRequest): string {
  const { kind, current, instruction, projectName } = request

  const lines = [
    `You are building one scene of a product demo called "${projectName}".`,
    'It will be on screen for a few seconds while someone talks over it, so it carries the',
    'shape of an idea, not the whole of it.',
    ''
  ]

  if (kind === 'scene') {
    lines.push(
      current?.title
        ? 'The slide currently says:'
        : 'There is no slide yet. Write one.',
      ...(current?.title
        ? [`  Title: ${current.title}`, ...(current.bullets ?? []).map((bullet) => `  - ${bullet}`), '']
        : ['']),
      `What is wanted: ${instruction}`,
      '',
      'Reply with JSON and nothing else, in exactly this shape:',
      '  {"title": "…", "bullets": ["…", "…"]}',
      '- A title of a few words. Not a sentence, not a heading with a colon in it.',
      '- At most four bullets, each under about nine words. Fewer is better.',
      '- Bullets are not sentences and do not end in full stops.',
      '- Say only what the demo can show. Do not invent features, numbers or names.'
    )
  } else {
    lines.push(
      current?.source ? 'The diagram is currently:' : 'There is no diagram yet. Write one.',
      ...(current?.source ? ['```', current.source, '```', ''] : ['']),
      `What is wanted: ${instruction}`,
      '',
      'Reply with JSON and nothing else, in exactly this shape:',
      '  {"title": "…", "source": "…"}',
      '- `source` is valid mermaid. Prefer `flowchart LR` or `flowchart TD`; sequence and state',
      '  diagrams are fine where they suit the idea better.',
      '- Keep it to about seven nodes. A diagram nobody can read at a glance is worse than none.',
      '- Node labels are short. No markdown inside them.',
      '- `title` is a few words naming what the diagram shows, or omitted if the diagram speaks',
      '  for itself.'
    )
  }

  return lines.join('\n')
}

/**
 * Read the model's answer back into a scene.
 *
 * Models wrap JSON in prose or fences however firmly they are asked not to, so the object is
 * found in the answer rather than assumed to be the whole of it — and validated against the
 * same schema the timeline uses, so a malformed scene is refused here rather than written to
 * the project and failing to render later.
 */
export function parseScene(kind: SceneKind, answer: string): SceneResult {
  const start = answer.indexOf('{')
  const end = answer.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { status: 'failed', reason: 'The model did not answer with a scene.' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(answer.slice(start, end + 1))
  } catch {
    return { status: 'failed', reason: 'The model’s answer was not readable as a scene.' }
  }

  const schema = kind === 'scene' ? TextSceneDataSchema : DiagramSceneDataSchema
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { status: 'failed', reason: `The model wrote a scene that cannot be shown: ${parsed.error.issues[0]?.message}` }
  }

  return { status: 'written', data: parsed.data }
}
