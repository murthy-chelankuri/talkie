import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { homedir } from 'os'
import { promisify } from 'util'
import { findCli } from './findCli'
import { INSTALL_HINT as COPILOT_INSTALL_HINT } from './copilotCliProvider'
import { grantRunToken } from '../settings/mcpAccess'
import { readSettings } from '../settings/settingsStore'
import { openProject, readTimeline, readTranscript } from '../project/projectApi'
import { richTextToPlain } from '../project/timeline/richText'
import { describeProjectContext } from '../project/projectContext'

const execFileAsync = promisify(execFile)

/**
 * Asking Talkie to change a project, in a sentence.
 *
 * The app already knew how to do one thing at a time on its own: rewrite this line, write that
 * slide. What it could not do was anything that spans a project — "add an introduction and a
 * closing statement", "the middle three all say the same thing, fix it" — because every one of
 * those is several operations whose shape depends on what is already there.
 *
 * Rather than build an agent, this lends one the tools Talkie already exposes. The MCP server
 * is the whole project API as tools, and the CLI provider is an agent that can call them, so
 * the two are introduced to each other: the CLI is launched with Talkie's own server attached
 * and nothing else, and told which project it is working on.
 *
 * What that buys is that the in-app agent and an outside agent are the same agent, working
 * through the same tools with the same rules. There is no second implementation to keep in
 * step, and a tool that is safe for one is safe for the other.
 */

/** Long enough for several tool calls and a considered answer; short enough to give up on. */
const TIMEOUT_MS = 10 * 60 * 1000

/**
 * The tools the agent may call without being asked.
 *
 * Everything that reads, and everything that edits words, scenes and their order. Deliberately
 * not here: recording a browser, and exporting. Both take minutes, both are hard to undo by
 * reading a timeline, and neither is what someone means by "add an introduction".
 */
export const AGENT_TOOLS = [
  // Reading
  'talkie_project',
  'talkie_timeline',
  'talkie_clip_actions',
  // Saying what the project is
  'talkie_set_context',
  'talkie_list_voices',
  'talkie_set_voice',
  // How it looks. Deleting a theme is left out: the library is shared by every project, and a
  // run is one undo step for this one — there is no taking back a theme gone from all of them.
  'talkie_list_themes',
  'talkie_theme',
  'talkie_create_theme',
  'talkie_update_theme',
  'talkie_duplicate_theme',
  'talkie_apply_theme',
  // Making
  'talkie_add_scene',
  'talkie_add_diagram',
  'talkie_add_image',
  'talkie_import_deck',
  'talkie_html_templates',
  'talkie_html_scene_guide',
  'talkie_add_html_scene',
  'talkie_html_scene',
  'talkie_edit_html_scene',
  'talkie_check_html_scene',
  // Changing
  'talkie_edit_slide',
  'talkie_edit_diagram',
  'talkie_set_narration',
  'talkie_draft_narration',
  'talkie_set_duration',
  // Arranging
  'talkie_move_clip',
  'talkie_split_clip',
  'talkie_delete_clip',
  // Cutting it different ways: "make a two-minute version" is exactly what someone asks for
  'talkie_versions',
  'talkie_include_clip',
  'talkie_create_version',
  'talkie_choose_version',
  'talkie_rename_version',
  'talkie_delete_version',
  // Taking it back
  'talkie_undo',
  'talkie_redo',
  // When a tool fails, so the agent can say why rather than guess
  'talkie_diagnostics'
]

export type AgentOutcome =
  | {
      status: 'done'
      say: string
      /** Hand back to the next turn so the conversation carries on where it left off. */
      sessionId?: string
      /** What that turn cost, when the CLI says. Shown because a run is not free. */
      costUsd?: number
    }
  | { status: 'failed'; reason: string }

export interface AgentRequest {
  projectId: string
  /** What the user asked for, in their words. */
  instruction: string
  /** Where the built MCP server is, from mcpConnection.ts. Null in a build without one. */
  serverPath: string | null
  /**
   * The conversation this turn belongs to, from the previous turn's outcome.
   *
   * Without it every message starts again knowing nothing, which is fine for one instruction
   * and wrong for anything that reads as a conversation — "make that shorter" has to know what
   * "that" was.
   */
  resumeSessionId?: string
  /**
   * The clips the person means, picked beside the box. "Make this shorter" in a project of
   * twenty scenes is a guess without them, and asking about one scene was the commonest thing
   * people wanted and could not say.
   */
  scenes?: string[]
}

const KIND_NAMES: Record<string, string> = { scene: 'slide', video: 'recording', image: 'picture', diagram: 'diagram', html: 'HTML scene' }

/**
 * The scenes the person picked, described the way talkie_timeline numbers them, so the agent
 * starts from the right clips rather than hunting for which ones "this" meant. Every turn carries
 * it: the picked scenes can change between messages.
 */
export function describeScenes(projectId: string, sceneIds: string[], baseDir: string = homedir()): string {
  if (sceneIds.length === 0) return ''
  const timeline = readTimeline(projectId, baseDir)
  const transcript = readTranscript(projectId, baseDir)
  const time = (frames: number): string => {
    const seconds = Math.round(frames / 30)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  }
  const lines = sceneIds.flatMap((id) => {
    const index = timeline.findIndex((item) => item.id === id)
    if (index === -1) return []
    const item = timeline[index]
    const title = richTextToPlain((item.data as { title?: string } | null)?.title ?? '')
    const narration = transcript.find((segment) => segment.timelineItemId === id)?.text.trim()
    return [
      `- Scene ${index + 1} (clip id ${id}): ${KIND_NAMES[item.kind] ?? item.kind}${title ? ` "${title}"` : ''}, ` +
        `${time(item.start)}–${time(item.start + item.duration)}. ` +
        (narration ? `Narration now: "${narration.length > 400 ? `${narration.slice(0, 400)}…` : narration}"` : 'No narration yet.')
    ]
  })
  if (lines.length === 0) return ''
  return [
    `They are asking about ${lines.length === 1 ? 'this scene' : 'these scenes'} in particular. "This" and "here" mean ${lines.length === 1 ? 'it' : 'them'}; change ${lines.length === 1 ? 'it' : 'them'} and leave the rest alone unless they say otherwise:`,
    ...lines
  ].join('\n')
}

export function buildAgentPrompt(
  projectId: string,
  instruction: string,
  project: { name: string; context?: string }
): string {
  return [
    `You are working on a Talkie project called "${project.name}", id ${projectId}.`,
    'Talkie makes narrated demo videos: a timeline of clips, each with narration spoken over it.',
    ...(project.context ? ['', project.context] : []),
    '',
    'What you have been asked to do:',
    instruction,
    '',
    'Start with talkie_project and talkie_timeline, so you are changing what is actually there',
    'and writing in the terms this project already uses.',
    '',
    'Things that are easy to get wrong here:',
    '- The words on a slide and the words said over it are two different things.',
    '  talkie_edit_slide changes the picture; talkie_set_narration changes the voice. Rewording',
    '  an opening usually means both, or the screen and the narration stop agreeing.',
    '- Anything new is added at the end. Use talkie_move_clip to put it where it belongs.',
    '- A new scene — a slide, steps, a timeline, a chart — is an HTML scene: talkie_html_templates, then',
    '  talkie_add_html_scene with a template and its values. It is what the person makes in the app.',
    '- Narration is written as timed lines: "[0.0] Here is the watchlist." talkie_clip_actions',
    '  says when things happen in a recorded clip, so read it before timing anything.',
    '- A slide holds for as long as talkie_set_duration says. A recording plays its own footage.',
    '',
    'Do what was asked and no more: this is someone\'s project, and a change they did not ask',
    'for is one they have to find and undo. If you make a mess, talkie_undo steps back your own',
    'changes. When you are done, say in one or two sentences what you changed, naming the',
    'scenes. If the request cannot be done with these tools, say so plainly instead of doing',
    'something else.'
  ].join('\n')
}

/**
 * Run one instruction against one project.
 *
 * The token lives exactly as long as the run. It is written to settings because the server is a
 * child process that reads them, and withdrawn in a `finally` whatever happens — including when
 * the CLI times out, which is the case that would otherwise leave a working credential behind.
 */
export async function runProjectAgent(
  request: AgentRequest,
  baseDir: string = homedir()
): Promise<AgentOutcome> {
  const { mcp, narration } = readSettings(baseDir)

  if (!request.serverPath) {
    return { status: 'failed', reason: 'This build has no agent server to connect to.' }
  }
  if (!mcp.enabled) {
    return {
      status: 'failed',
      reason: 'Turn on "Let AI agents connect" in Settings → System. Talkie drives its own agent through that same door.'
    }
  }

  // Only the CLI providers bring an agent that can call tools. The others answer one question
  // at a time, which is not enough to work out what a project needs and then change it.
  if (narration.provider !== 'claude-cli' && narration.provider !== 'copilot-cli') {
    return {
      status: 'failed',
      reason:
        'This needs the Claude CLI or the GitHub Copilot CLI. Choose one under Settings → Narration, and make sure it is installed and signed in.'
    }
  }

  const binary = await findCli(narration.provider === 'claude-cli' ? 'claude' : 'copilot')
  if (!binary) {
    return {
      status: 'failed',
      reason:
        narration.provider === 'claude-cli'
          ? 'This needs the Claude CLI. Choose it under Settings → Narration, and make sure `claude` is installed and signed in.'
          : COPILOT_INSTALL_HINT
    }
  }

  const project = projectFacts(request.projectId, baseDir)
  const { token, withdraw } = grantRunToken(baseDir)
  // A turn that carries on says only what is new; the first one has to set the scene.
  const carryingOn = Boolean(request.resumeSessionId)
  const focus = describeScenes(request.projectId, request.scenes ?? [], baseDir)
  const instruction = focus ? `${focus}\n\n${request.instruction}` : request.instruction
  const prompt = carryingOn ? instruction : buildAgentPrompt(request.projectId, instruction, project)
  const mcpServers = {
    talkie: {
      command: 'node',
      args: [request.serverPath],
      // An environment variable rather than an argument: arguments are visible to anything that
      // can list processes.
      env: { TALKIE_MCP_TOKEN: token, TALKIE_HOME: baseDir }
    }
  }

  const stop = new AbortController()
  running.set(request.projectId, stop)
  try {
    const { said, sessionId, costUsd } =
      narration.provider === 'claude-cli'
        ? await runClaude(binary, prompt, mcpServers, request.resumeSessionId, narration.claudeCli.model, stop.signal)
        : await runCopilot(binary, prompt, mcpServers, request.resumeSessionId, narration.copilotCli.model, stop.signal)

    return said.trim()
      ? { status: 'done', say: said.trim(), sessionId, costUsd }
      : { status: 'failed', reason: 'The agent finished without saying what it did.' }
  } catch (err) {
    if (stop.signal.aborted) {
      return { status: 'failed', reason: 'Stopped. Anything it had already changed is still there — Undo takes the whole run back.' }
    }
    return { status: 'failed', reason: whyItFailed(err) }
  } finally {
    if (running.get(request.projectId) === stop) running.delete(request.projectId)
    withdraw()
  }
}

/** The run going on for each project, so it can be stopped. */
const running = new Map<string, AbortController>()

/** Whether the in-app agent is changing this project now — its writes come from another process. */
export function isProjectAgentRunning(projectId: string): boolean {
  return running.has(projectId)
}

/**
 * Stop the run on a project. A run can take minutes and there was no way out of one: the button
 * that looked like Stop was disabled. What it already changed stays, as one undo step.
 */
export function stopProjectAgent(projectId: string): boolean {
  const run = running.get(projectId)
  if (!run) return false
  run.abort()
  return true
}

type McpServers = Record<string, { command: string; args: string[]; env: Record<string, string> }>

async function runClaude(
  binary: string,
  prompt: string,
  mcpServers: McpServers,
  resumeSessionId?: string,
  model?: string,
  signal?: AbortSignal
): Promise<AgentSaid> {
  const child = execFileAsync(
    binary,
    [
      '-p',
      prompt,
      ...(resumeSessionId ? ['--resume', resumeSessionId] : []),
      ...(model ? ['--model', model] : []),
      '--output-format',
      'json',
      '--mcp-config',
      JSON.stringify({ mcpServers }),
      // Talkie's tools and nothing else: whatever else this machine has configured is not part
      // of what the person asked for.
      '--strict-mcp-config',
      '--allowedTools',
      AGENT_TOOLS.map((tool) => `mcp__talkie__${tool}`).join(',')
    ],
    { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, signal }
  )

  // Closed at once, or the CLI waits three seconds for input that is never coming.
  child.child.stdin?.end()
  const { stdout } = await child
  return readResult(stdout)
}

/**
 * Copilot CLI speaks differently to Claude in ways only found by running it against a throwaway
 * MCP server, since none of this is documented:
 *
 * - `--session-id` lets a run set its own id up front rather than only being handed one back, so
 *   resume works the same way as Claude despite Copilot not yet putting a session id on stdout
 *   in `-s` mode (github/copilot-cli#807) — Talkie mints the id itself and reuses it.
 * - Restricting the toolset takes two flags that disagree on how to name a tool. Copilot's own
 *   built-ins (bash, edit, web_fetch...) are there unless `--available-tools` lists everything
 *   that should exist instead, addressed as `server-tool`; `--allow-tool` only stops it asking
 *   permission for what's already on that list, addressed as `server(tool)`. Both are needed —
 *   the first tried alone still asks for permission and hangs, since nothing here can answer.
 * - `--disable-builtin-mcps` drops the GitHub MCP server Copilot otherwise attaches by default,
 *   which is no part of what anyone asked "Ask Talkie" to do.
 */
async function runCopilot(
  binary: string,
  prompt: string,
  mcpServers: McpServers,
  resumeSessionId?: string,
  model?: string,
  signal?: AbortSignal
): Promise<AgentSaid> {
  const sessionId = resumeSessionId ?? randomUUID()

  const child = execFileAsync(
    binary,
    [
      '-p',
      prompt,
      resumeSessionId ? '--resume' : '--session-id',
      sessionId,
      // Only the answer, with none of the session banner a person would read.
      '-s',
      // Nothing is watching this run, so a question would hang until the timeout.
      '--no-ask-user',
      '--additional-mcp-config',
      JSON.stringify({ mcpServers }),
      '--disable-builtin-mcps',
      ...(model ? ['--model', model] : []),
      ...AGENT_TOOLS.flatMap((tool) => ['--available-tools', `talkie-${tool}`]),
      ...AGENT_TOOLS.flatMap((tool) => ['--allow-tool', `talkie(${tool})`])
    ],
    { timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, signal }
  )

  child.child.stdin?.end()
  const { stdout } = await child
  return { said: stdout.trim(), sessionId }
}

interface AgentSaid {
  said: string
  sessionId?: string
  costUsd?: number
}

function readResult(stdout: string): AgentSaid {
  try {
    const parsed = JSON.parse(stdout) as {
      result?: unknown
      session_id?: unknown
      total_cost_usd?: unknown
    }
    return {
      said: typeof parsed.result === 'string' ? parsed.result : '',
      sessionId: typeof parsed.session_id === 'string' ? parsed.session_id : undefined,
      costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : undefined
    }
  } catch {
    // Not the shape expected, but the agent may still have done the work and said so in plain
    // text — losing that would be worse than showing it.
    return { said: stdout.trim().slice(0, 2000) }
  }
}

/** What the CLI said went wrong, rather than the prompt it was handed. */
function whyItFailed(err: unknown): string {
  const stderr = (err as { stderr?: string } | null)?.stderr?.trim()
  const said = (stderr ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^warning:/i.test(line))

  if (said.length > 0) return said[said.length - 1]
  if ((err as { killed?: boolean } | null)?.killed) return 'The agent took too long and was stopped.'
  return err instanceof Error ? err.message.split('\n')[0] : String(err)
}

function projectFacts(projectId: string, baseDir: string): { name: string; context?: string } {
  try {
    const project = openProject(projectId, baseDir)
    const context = describeProjectContext(project.context)
    return { name: project.name, context: context.length > 0 ? context.join('\n') : undefined }
  } catch {
    return { name: 'this project' }
  }
}
