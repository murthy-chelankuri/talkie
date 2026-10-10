import { homedir } from 'os'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createProject,
  listProjectOverviews,
  readTimeline,
  readTranscript,
  addScene,
  updateSceneData,
  writeDiagramSvg,
  openProject,
  setProjectContext,
  setProjectVoice,
  importImage,
  updateTimelineItemDuration,
  addTranscriptSegment,
  updateTranscriptSegmentText,
  splitTimelineItem,
  moveTimelineItem,
  deleteTimelineItem
} from '../main/project/projectApi'
import { withHistory } from '../main/project/history'
import { draftNarrationForItem, draftNarrationForProject } from '../main/agent/draftNarration'
import { narrateSegment } from '../main/transcript/narrate'
import { renderProjectVideo } from '../main/render/renderProject'
import { richTextToPlain } from '../main/project/timeline/richText'
import { describeProjectContext } from '../main/project/projectContext'
import { clipActions } from '../main/agent/clipEvidence'
import { narrationFromText } from '../main/transcript/narrationBeats'
import { SceneStyleSchema } from '../main/project/timeline/schema'
import type { TimelineItem } from '../main/project/timeline/schema'
import { prepareDeck, saveSlides } from '../main/slides/importSlides'
import { rasterisePdf } from '../main/slides/rasterisePdf'
import { renderMermaidHeadless } from '../main/slides/renderMermaidHeadless'
import { undo, redo } from '../main/project/history'
import { ProjectContextSchema } from '../main/project/projectContext'
import { checkMcpAccess, explainRefusal } from '../main/settings/mcpAccess'
import * as recording from './recordingSession'

/** Where projects live. Overridable so the tests do not touch the real ones. */
export function talkieHome(): string {
  return process.env.TALKIE_HOME || homedir()
}

/** Tools answer in text: it is what every client can render, and what a model reads best. */
function text(body: string): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text' as const, text: body }] }
}

function describeItem(item: TimelineItem, index: number): string {
  const seconds = (item.duration / 30).toFixed(1)
  const data = item.data as { title?: string; source?: string; trimBefore?: number; trimAfter?: number } | null
  const name =
    item.kind === 'scene' || item.kind === 'diagram'
      ? richTextToPlain(data?.title ?? '') || 'untitled'
      : item.kind

  // A recorded session arrives as several scenes cut from one file, so which stretch this one
  // plays is the difference between "clip 3" and something an agent can reason about.
  const from = (data?.trimBefore ?? 0) / 30
  const window =
    item.kind === 'video' && (data?.trimBefore || data?.trimAfter)
      ? `, recording ${from.toFixed(1)}–${((data?.trimAfter ?? 0) / 30 || from + item.duration / 30).toFixed(1)}s`
      : ''

  return `${index + 1}. ${item.kind} — ${name} (${seconds}s${window}, id ${item.id})`
}

/**
 * Draw a diagram, turning a failure into something to read rather than an exception.
 *
 * Mermaid's own errors name the line and what it did not understand, and the person who wrote
 * the source is the one who can fix it — so they are passed through rather than summarised.
 */
async function draw(source: string): Promise<{ ok: true; svg: string } | { ok: false; reason: string }> {
  try {
    return { ok: true, svg: await renderMermaidHeadless(source) }
  } catch (err) {
    const said = err instanceof Error ? err.message.split('\n')[0] : String(err)
    return { ok: false, reason: `That diagram could not be drawn: ${said}` }
  }
}

/** The token this server was started with, from its own configuration. */
export function presentedToken(): string | undefined {
  return process.env.TALKIE_MCP_TOKEN || undefined
}

export function createTalkieServer(
  baseDir: string = talkieHome(),
  token: string | undefined = presentedToken()
): McpServer {
  const server = new McpServer({ name: 'talkie', version: '1.0.0' })

  /**
   * Checked before every tool, not once at startup.
   *
   * An agent holds its connection open for as long as it is running, so a check made only at
   * startup would leave a withdrawn token working until the agent happened to restart. Settings
   * are a small JSON file; reading it per call costs nothing worth saving.
   */
  function requireAccess(): void {
    const { allowed, refusedBecause } = checkMcpAccess(token, baseDir)
    if (!allowed && refusedBecause) throw new Error(explainRefusal(refusedBecause))
  }

  /**
   * Register a tool that cannot be called without access.
   *
   * Every tool goes through here rather than each one remembering to check, so a tool added
   * later is guarded by the act of existing — the failure this shape rules out is the one that
   * matters, a new tool that quietly skips the gate.
   */
  const tool: typeof server.registerTool = (name, config, cb) =>
    server.registerTool(
      name,
      config,
      ((...args: Parameters<typeof cb>) => {
        requireAccess()
        return (cb as (...a: unknown[]) => unknown)(...args)
      }) as typeof cb
    )

  // ---------------------------------------------------------------- projects

  tool(
    'talkie_list_projects',
    {
      title: 'List projects',
      description: 'Every Talkie project, with how many clips each holds and how many are narrated.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const projects = listProjectOverviews(baseDir)
      if (projects.length === 0) return text('No projects yet. Create one with talkie_create_project.')

      return text(
        projects
          .map((p) => `${p.name} — ${p.clipCount} clip(s), ${p.narratedCount} narrated (id ${p.id})`)
          .join('\n')
      )
    }
  )

  tool(
    'talkie_create_project',
    {
      title: 'Create a project',
      description: 'Start a new demo. Returns the project id every other tool needs.',
      inputSchema: { name: z.string().describe('What this demo is about, e.g. "Checkout walkthrough"') }
    },
    async ({ name }) => {
      const project = createProject(name, baseDir)
      return text(`Created "${project.name}".\nProject id: ${project.id}`)
    }
  )

  tool(
    'talkie_timeline',
    {
      title: 'Read a timeline',
      description: 'The clips in a project, in order, with their narration.',
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ projectId }) => {
      const timeline = readTimeline(projectId, baseDir)
      if (timeline.length === 0) return text('This project has no clips yet.')

      const transcript = readTranscript(projectId, baseDir)
      const lines = timeline.map((item, index) => {
        const segment = transcript.find((s) => s.timelineItemId === item.id)
        // Whether the take is timed to moments or read as one block is the thing that decides
        // if it keeps step with the picture, so it belongs in the listing.
        // The timings themselves, not just how many: without them a beat cannot be adjusted
        // without rewriting the whole take from memory, and an edit someone else made is
        // invisible.
        const narration = segment
          ? segment.beats?.length
            ? `\n   narration (${segment.status}), timed:\n` +
              segment.beats.map((beat) => `     [${beat.at.toFixed(1)}] ${beat.text}`).join('\n')
            : `\n   narration (${segment.status}), read straight through: ${segment.text}`
          : '\n   no narration yet'
        return describeItem(item, index) + narration
      })

      return text(lines.join('\n'))
    }
  )

  tool(
    'talkie_project',
    {
      title: 'Read a project',
      description:
        'What this project is: its name, the voice it speaks in, and what the person making it ' +
        'said it is about. Read this before writing anything — the background, the audience and ' +
        'the things never to say are what make narration sound like it belongs to this product ' +
        'rather than any other.',
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ projectId }) => {
      const project = openProject(projectId, baseDir)
      const context = project.context
      const said = describeProjectContext(context)
      const sayings = (context?.pronunciations ?? []).map((entry) => `  - ${entry.written} → ${entry.spoken}`)

      return text(
        [
          `${project.name} (id ${project.id})`,
          `Voice: ${project.voice?.trim() || 'whatever Talkie is set to'}`,
          '',
          said.length > 0
            ? said.join('\n')
            : 'Nothing recorded about what this project is for. talkie_set_context is how to say.',
          // Kept out of describeProjectContext: drafting should write the name as it is spelled,
          // and only the voice hears the respelling. An agent setting context still needs to see
          // them, or sending the context back would be the way they were lost.
          ...(sayings.length > 0 ? ['', 'Said differently from how they are written (voice only):', ...sayings] : [])
        ].join('\n')
      )
    }
  )

  tool(
    'talkie_set_context',
    {
      title: 'Say what the project is about',
      description:
        'Record what this project is for, so every draft after it knows. Replaces what is there, ' +
        'so read it with talkie_project first and send back the whole thing rather than the one ' +
        'field being changed.',
      inputSchema: {
        projectId: z.string(),
        background: z.string().describe('The product, what it does, and the words it uses for its own parts'),
        audience: z.string().optional().describe('Who is watching, which decides what is assumed'),
        tone: z.string().optional().describe('How it should sound'),
        neverSay: z.array(z.string()).optional().describe('Words and claims to keep out of it'),
        pronunciations: z
          .array(z.object({ written: z.string(), spoken: z.string() }))
          .optional()
          .describe(
            'Names the voice says wrong, each with a spelling it says right — "SecOps" as "Seck-ops". ' +
              'Only the voice hears the second; captions and the script keep the first. Left out, ' +
              'the ones already there are kept.'
          )
      }
    },
    async ({ projectId, background, audience, tone, neverSay, pronunciations }) => {
      // Kept when not sent: this field arrived after the tool did, and an agent written before it
      // sends back "the whole thing" without it — which would otherwise quietly erase them.
      const kept = pronunciations ?? openProject(projectId, baseDir).context?.pronunciations ?? []
      const context = ProjectContextSchema.parse({ background, audience, tone, neverSay, pronunciations: kept })
      withHistory(projectId, () => setProjectContext(projectId, context, baseDir), baseDir)
      return text('Noted. Drafts from here on will be written against it.')
    }
  )

  tool(
    'talkie_set_voice',
    {
      title: 'Choose the voice',
      description:
        'Set the voice this project is read in, by name — one of the system voices Talkie offers. ' +
        'Narration already recorded keeps the voice it was read in until it is voiced again.',
      inputSchema: {
        projectId: z.string(),
        voice: z.string().describe('A voice name, or empty to follow whatever Talkie is set to')
      }
    },
    async ({ projectId, voice }) => {
      const project = withHistory(
        projectId,
        () => setProjectVoice(projectId, voice.trim() || null, baseDir),
        baseDir
      )
      return text(
        project.voice
          ? `This project now speaks as ${project.voice}. Re-voice any clip that should change.`
          : 'This project now follows whatever voice Talkie is set to.'
      )
    }
  )

  tool(
    'talkie_set_duration',
    {
      title: 'How long a clip is on screen',
      description:
        'Set how long a clip holds, in seconds. A slide or an image is on screen for exactly as ' +
        'long as it is told to be, so this is how one is given room to breathe or cut short. A ' +
        'recording is different — it plays its own footage, and making it longer holds the last ' +
        'frame rather than showing more. Voicing a clip lengthens it on its own if the words do ' +
        'not fit, so set this after the narration rather than before.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline'),
        seconds: z.number().positive().describe('How long it should be on screen')
      }
    },
    async ({ projectId, timelineItemId, seconds }) => {
      const frames = Math.max(1, Math.round(seconds * 30))
      const item = withHistory(
        projectId,
        () => updateTimelineItemDuration(projectId, timelineItemId, frames, baseDir),
        baseDir
      )
      return text(`That clip is now on screen for ${(item.duration / 30).toFixed(1)}s.`)
    }
  )

  tool(
    'talkie_undo',
    {
      title: 'Undo the last change',
      description:
        'Step back one change made in this session. Only your own: undo is remembered per ' +
        'connection, so this cannot reach edits made in the Talkie window or by another agent, ' +
        'and it steps back by whole actions rather than by write.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      const state = undo(projectId, baseDir)
      return text(
        state.canUndo
          ? 'Stepped back one change. There is more that can be undone.'
          : 'Stepped back. Nothing further of yours to undo.'
      )
    }
  )

  tool(
    'talkie_redo',
    {
      title: 'Redo what was undone',
      description: 'Put back the change talkie_undo stepped over, if nothing has been written since.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      const state = redo(projectId, baseDir)
      return text(state.canRedo ? 'Put back. There is more that can be redone.' : 'Put back.')
    }
  )

  // --------------------------------------------------------------- recording

  tool(
    'talkie_start_recording',
    {
      title: 'Start recording',
      description:
        'Open a real browser window and start recording it. Drive it with talkie_navigate, ' +
        'talkie_click, talkie_type and talkie_scroll, then call talkie_stop_recording to put it ' +
        'on the timeline. Every tab is followed, so opening a link in a new one keeps recording. ' +
        'The session is cut into scenes on the way in, roughly one every fifteen seconds and on ' +
        'whatever happened nearest that mark, so expect several clips back rather than one. ' +
        'One recording at a time.',
      inputSchema: {
        projectId: z.string(),
        url: z.string().describe('Where the demo starts, e.g. "example.com/pricing"')
      },
      annotations: { openWorldHint: true }
    },
    async ({ projectId, url }) => {
      const sessionId = await recording.beginRecording(projectId, url, baseDir)
      return text(
        `Recording ${url}. The browser is open and everything it does from here is being captured.\n` +
          `Session ${sessionId}. Call talkie_stop_recording when the walkthrough is done.`
      )
    }
  )

  tool(
    'talkie_explore',
    {
      title: 'Walk the app by itself',
      description:
        'Let Talkie find its own way round the app being recorded, instead of you driving every ' +
        'click. It follows links, tabs and menus and takes a route someone showing the app off ' +
        'would take. It never types, never submits a form, never presses anything whose label ' +
        'says it acts (Delete, Send, Pay, Cancel) and never signs out or leaves the origin it ' +
        'started on — so it is safe to point at a real system, but flows that need input will ' +
        'not be demoed. Use talkie_click and talkie_type for those. Returns where it went.',
      inputSchema: {},
      annotations: { openWorldHint: true }
    },
    async () => {
      const { visited, ending } = await recording.exploreActiveRecording(baseDir)
      if (ending === 'waited-too-long') {
        return text(
          'The app asked to be signed in and nobody did. The browser is open — sign in there, ' +
            'then call talkie_explore again.'
        )
      }
      if (visited.length === 0) {
        return text('Found nothing safe to explore from here. Drive it with talkie_click instead.')
      }
      return text(
        `Walked the app, showing: ${visited.join(' → ')}.\n` +
          'Still recording — carry on, or call talkie_stop_recording.'
      )
    }
  )

  tool(
    'talkie_navigate',
    {
      title: 'Go to a page',
      description: 'Navigate the recorded browser to a URL.',
      inputSchema: { url: z.string() },
      annotations: { openWorldHint: true }
    },
    async ({ url }) => text(`Now at ${await recording.navigate(url)}`)
  )

  tool(
    'talkie_click',
    {
      title: 'Click',
      description:
        'Click something in the recorded browser. Give either the visible `text` on it or a CSS ' +
        '`selector`; text is usually the better choice.',
      inputSchema: {
        text: z.string().optional().describe('The words on the thing to click'),
        selector: z.string().optional().describe('A CSS selector, when the text is ambiguous')
      },
      annotations: { openWorldHint: true }
    },
    async ({ text: label, selector }) => {
      await recording.click({ selector, text: label })
      return text(`Clicked ${selector ?? `"${label}"`}.`)
    }
  )

  tool(
    'talkie_type',
    {
      title: 'Type into a field',
      description: 'Type into a field in the recorded browser, optionally pressing Enter afterwards.',
      inputSchema: {
        value: z.string().describe('What to type'),
        text: z.string().optional().describe('The field’s visible label or placeholder'),
        selector: z.string().optional().describe('A CSS selector for the field'),
        submit: z.boolean().optional().describe('Press Enter when done')
      },
      annotations: { openWorldHint: true }
    },
    async ({ value, text: label, selector, submit }) => {
      await recording.type({ selector, text: label, value, submit })
      return text(`Typed "${value}"${submit ? ' and pressed Enter' : ''}.`)
    }
  )

  tool(
    'talkie_scroll',
    {
      title: 'Scroll',
      description: 'Scroll the recorded page: "top", "bottom", or a number of pixels.',
      inputSchema: { to: z.union([z.literal('top'), z.literal('bottom'), z.number()]) },
      annotations: { openWorldHint: true }
    },
    async ({ to }) => {
      await recording.scroll(to)
      return text(`Scrolled to ${to}.`)
    }
  )

  tool(
    'talkie_wait',
    {
      title: 'Wait',
      description:
        'Pause the recording on what is currently on screen — for something to appear, or simply ' +
        'to give a viewer time to read it.',
      inputSchema: {
        seconds: z.number().optional().describe('How long to hold, up to 60'),
        selector: z.string().optional().describe('Wait until this appears')
      },
      annotations: { openWorldHint: true }
    },
    async ({ seconds, selector }) => {
      await recording.waitFor({ seconds, selector })
      return text(selector ? `${selector} appeared.` : `Held for ${seconds ?? 0}s.`)
    }
  )

  tool(
    'talkie_stop_recording',
    {
      title: 'Stop recording',
      description:
        'Close the browser and add what was recorded to the project timeline, cut into scenes. ' +
        'Each scene is narrated separately, which is what keeps the words in step with the ' +
        'picture — so narrate them one at a time rather than writing one take for the session.',
      inputSchema: {}
    },
    async () => {
      const items = await recording.finishRecording(baseDir)
      const seconds = items.reduce((total, item) => total + item.duration, 0) / 30
      // Every clip is listed rather than only the total: each one takes its own narration, and
      // an agent that is not told their ids cannot write any of it.
      return text(
        `Recording added to the timeline as ${items.length} clip${items.length === 1 ? '' : 's'}, ` +
          `${seconds.toFixed(1)}s in all:\n` +
          items.map((item) => `  ${item.id} — ${(item.duration / 30).toFixed(1)}s`).join('\n') +
          '\nGive each one words with talkie_set_narration or talkie_draft_narration.'
      )
    }
  )

  tool(
    'talkie_discard_recording',
    {
      title: 'Discard the recording',
      description: 'Close the browser and keep nothing. For a run that went wrong.',
      inputSchema: {}
    },
    async () => {
      await recording.discardRecording()
      return text('Recording discarded. Nothing was added to the timeline.')
    }
  )

  // ------------------------------------------------------------------ slides

  tool(
    'talkie_add_scene',
    {
      title: 'Add a slide',
      description:
        'Add a title slide to the end of the timeline — for an opening, a summary, or a point ' +
        'that no screen recording shows. Keep the lines short: they are read on screen, not aloud.',
      inputSchema: {
        projectId: z.string(),
        title: z.string(),
        bullets: z.array(z.string()).optional().describe('A few short lines, or none at all'),
        style: SceneStyleSchema.partial().optional().describe('Theme, font, alignment, accent colour')
      }
    },
    async ({ projectId, title, bullets, style }) => {
      const item = withHistory(
        projectId,
        () => addScene(projectId, 'scene', { title, bullets: bullets ?? [], style: style ?? {} }, baseDir),
        baseDir
      )
      return text(
        `Added the slide "${title}" at the end (clip id ${item.id}). ` +
          'Use talkie_move_clip if it belongs somewhere else.'
      )
    }
  )

  tool(
    'talkie_add_image',
    {
      title: 'Add a picture',
      description:
        'Put an image on the end of the timeline — a screenshot, a logo, a diagram drawn ' +
        'elsewhere. The file is copied into the project, so it does not matter if the original ' +
        'moves afterwards. Use talkie_move_clip to place it and talkie_set_duration to say how ' +
        'long it holds.',
      inputSchema: {
        projectId: z.string(),
        path: z.string().describe('An absolute path to a png, jpg, gif, webp or svg on this machine')
      }
    },
    async ({ projectId, path }) => {
      const item = withHistory(projectId, () => importImage(projectId, path, baseDir), baseDir)
      return text(
        `Added the picture at the end (clip id ${item.id}), on screen for ` +
          `${(item.duration / 30).toFixed(1)}s.`
      )
    }
  )

  tool(
    'talkie_import_deck',
    {
      title: 'Import a slide deck',
      description:
        'Turn a .pdf or .pptx into slides on the timeline, one clip per page, with any speaker ' +
        'notes kept as the narration for their own slide. Notes are stored as the author\'s own ' +
        'words, so drafting will not overwrite a script somebody already wrote in PowerPoint.\n' +
        'A .pptx needs LibreOffice installed to be rendered; without it the notes are still ' +
        'readable and this says so, so exporting the deck as a PDF is the way through.',
      inputSchema: {
        projectId: z.string(),
        path: z.string().describe('An absolute path to a .pdf or .pptx on this machine')
      }
    },
    async ({ projectId, path }) => {
      const deck = await prepareDeck(path)

      if (deck.status === 'needs-pdf') {
        return text(
          `${deck.reason}\n` +
            (deck.notes.some((note) => note.trim())
              ? 'The speaker notes were readable and will be used when the PDF is imported.'
              : 'There were no speaker notes to read.')
        )
      }
      if (deck.status !== 'ready') {
        return text('Nothing was imported.')
      }

      const pages = await rasterisePdf(deck.pdf)
      if (pages.length === 0) return text(`${deck.name} has no pages in it.`)

      const added = withHistory(
        projectId,
        () => saveSlides(projectId, pages, deck.notes, baseDir),
        baseDir
      )
      const withNotes = deck.notes.filter((note) => note.trim()).length

      return text(
        `Imported ${added.length} slide${added.length === 1 ? '' : 's'} from ${deck.name}` +
          `${withNotes > 0 ? `, ${withNotes} with speaker notes as narration` : ''}.\n` +
          'They are at the end of the timeline — use talkie_move_clip to place them, and ' +
          'talkie_set_duration to say how long each holds.'
      )
    }
  )

  tool(
    'talkie_add_diagram',
    {
      title: 'Add a diagram',
      description:
        'Add a diagram written as mermaid source — a flow, a sequence, an architecture. Better ' +
        'than describing a structure in words over a screen recording that does not show it. ' +
        'It is drawn straight away, so a syntax error comes back here rather than surfacing as ' +
        'a blank clip later. The source is kept, so it stays editable.',
      inputSchema: {
        projectId: z.string(),
        source: z.string().describe('mermaid source, e.g. "graph LR; A[Client] --> B[API]"'),
        title: z.string().optional().describe('A heading above it'),
        style: SceneStyleSchema.partial().optional().describe('Theme, font, alignment, accent colour')
      }
    },
    async ({ projectId, source, title, style }) => {
      const drawn = await draw(source)
      if (!drawn.ok) return text(drawn.reason)

      const item = withHistory(
        projectId,
        () =>
          addScene(
            projectId,
            'diagram',
            { source, title, style: style ?? {}, src: writeDiagramSvg(projectId, drawn.svg, baseDir) },
            baseDir
          ),
        baseDir
      )
      return text(
        `Added the diagram at the end (clip id ${item.id}). Use talkie_move_clip to place it.`
      )
    }
  )

  tool(
    'talkie_edit_diagram',
    {
      title: 'Change a diagram',
      description:
        'Rewrite the mermaid source of a diagram already in the project. It is redrawn straight ' +
        'away, so a syntax error comes back here rather than leaving a blank clip behind.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The diagram id, from talkie_timeline'),
        source: z.string().describe('mermaid source'),
        title: z.string().optional()
      }
    },
    async ({ projectId, timelineItemId, source, title }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)
      if (item.kind !== 'diagram') {
        return text(`That clip is a ${item.kind}, not a diagram.`)
      }

      const drawn = await draw(source)
      if (!drawn.ok) return text(drawn.reason)

      const current = item.data as { title?: string; style?: unknown }
      withHistory(
        projectId,
        () =>
          // Drawn again rather than kept: the old picture belongs to the old source, and
          // showing one while the project says the other is the worst of both.
          updateSceneData(
            projectId,
            timelineItemId,
            {
              source,
              title: title ?? current.title,
              style: current.style ?? {},
              src: writeDiagramSvg(projectId, drawn.svg, baseDir)
            },
            baseDir
          ),
        baseDir
      )
      return text('Redrawn.')
    }
  )

  tool(
    'talkie_edit_slide',
    {
      title: 'Change what a slide says',
      description:
        'Rewrite the words on a slide that is already in the project. This changes the picture ' +
        'on screen, which is not the same thing as talkie_set_narration — that changes what is ' +
        'said over it. Asked to reword an opening, you almost certainly want both. Only works ' +
        'on a slide; a recorded clip shows whatever was recorded.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The slide id, from talkie_timeline'),
        title: z.string(),
        bullets: z.array(z.string()).optional().describe('A few short lines, or none at all'),
        style: SceneStyleSchema.partial().optional().describe('Theme, font, alignment, accent colour')
      }
    },
    async ({ projectId, timelineItemId, title, bullets, style }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)
      if (item.kind !== 'scene') {
        return text(
          `That clip is a ${item.kind}, and only a slide has words that can be rewritten. ` +
            'Use talkie_set_narration to change what is said over a recording.'
        )
      }

      // Merged rather than replaced: leaving the bullets out should keep them, not silently
      // empty the slide.
      const current = item.data as { bullets?: string[]; style?: unknown }
      withHistory(
        projectId,
        () =>
          updateSceneData(
            projectId,
            timelineItemId,
            {
              title,
              bullets: bullets ?? current.bullets ?? [],
              style: style ?? current.style ?? {}
            },
            baseDir
          ),
        baseDir
      )

      return text(`The slide now reads "${title}".`)
    }
  )

  // --------------------------------------------------------------- narration

  tool(
    'talkie_move_clip',
    {
      title: 'Move a clip',
      description:
        'Put a clip at a different position in the project, counting from 1 as talkie_timeline ' +
        'lists them; everything else shuffles along. This is how a scene gets to the front — ' +
        'talkie_add_scene always appends, so an introduction arrives at the end and has to be ' +
        'moved to where it belongs.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline'),
        toPosition: z.number().int().min(1).describe('Where it should end up, counting from 1')
      }
    },
    async ({ projectId, timelineItemId, toPosition }) => {
      const moved = withHistory(
        projectId,
        () => moveTimelineItem(projectId, timelineItemId, toPosition, baseDir),
        baseDir
      )
      return text(
        `Moved it to position ${toPosition}. The project now runs:\n` +
          moved.map((item, index) => describeItem(item, index)).join('\n')
      )
    }
  )

  tool(
    'talkie_delete_clip',
    {
      title: 'Delete a clip',
      description:
        'Remove a clip from the project, along with the narration written for it. The recording ' +
        'it came from stays on disk. Use it to take back something you added; think twice before ' +
        'removing footage somebody recorded, which cannot be got back from here.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline')
      }
    },
    async ({ projectId, timelineItemId }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)

      withHistory(projectId, () => deleteTimelineItem(projectId, timelineItemId, baseDir), baseDir)
      return text(`Deleted the ${item.kind} clip. ${readTimeline(projectId, baseDir).length} left.`)
    }
  )

  tool(
    'talkie_set_narration',
    {
      title: 'Write narration',
      description:
        'Set the words spoken over one clip. Roughly 2.5 words a second — going long means the ' +
        'voice is hurried to fit, and past about a tenth faster the clip is stretched instead.\n' +
        'Time the lines. Start each one with the second it belongs to, in square brackets: ' +
        '"[0.0] Here is the watchlist." then "[8.5] And the analysis comes back." A recording ' +
        'does not move at a steady rate, so a take read straight through drifts ahead of the ' +
        'thing it describes; timed lines are read separately with real silence between them. ' +
        'Use talkie_clip_actions to find out what happens when. Untimed text still works and is ' +
        'read as one block.\n' +
        'Call talkie_narrate afterwards to turn it into audio.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline'),
        text: z.string().describe('Timed lines like "[0.0] ..." on separate lines, or plain prose')
      }
    },
    async ({ projectId, timelineItemId, text: words }) => {
      const existing = readTranscript(projectId, baseDir).find((s) => s.timelineItemId === timelineItemId)

      // Timings where they were given. The prose kept alongside is what the editor shows and
      // what captions are built from, so it has to be the same words without the brackets.
      const { text: prose, beats } = narrationFromText(words)

      const segment = withHistory(
        projectId,
        () =>
          existing
            ? updateTranscriptSegmentText(projectId, existing.id, prose, baseDir, beats)
            : addTranscriptSegment(projectId, { text: prose, timelineItemId, beats }, baseDir),
        baseDir
      )

      const timing = beats.length > 0 ? `${beats.length} timed lines` : 'read as one block'
      return text(`Narration set, ${timing} (segment id ${segment.id}).`)
    }
  )

  tool(
    'talkie_clip_actions',
    {
      title: 'What happens during a clip',
      description:
        'The things that happened while this clip was recorded — navigations, clicks and typing — ' +
        'each timed in seconds from the start of the clip. This is what to write timed narration ' +
        'against: it says where the demo waits and where it moves, which a clip length cannot. ' +
        'Empty for a slide or an imported image, which have nothing happening in them.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline')
      },
      annotations: { readOnlyHint: true }
    },
    async ({ projectId, timelineItemId }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)

      const seconds = (item.duration / 30).toFixed(1)
      const actions = item.kind === 'video' ? clipActions(item) : []
      if (actions.length === 0) {
        return text(`This clip is ${seconds}s long and has no recorded actions in it.`)
      }

      return text(
        `This clip is ${seconds}s long. What happened, in seconds from its start:\n` +
          actions.map((action) => `  [${action.atSeconds.toFixed(1)}] ${action.label}`).join('\n')
      )
    }
  )

  tool(
    'talkie_split_clip',
    {
      title: 'Split a clip in two',
      description:
        'Cut one clip into two at a moment inside it, so each half can be narrated on its own. ' +
        'Use this when a clip turns out to cover two subjects — a scene that is the tail of one ' +
        'thing and the head of the next cannot be narrated well, because it has two things to ' +
        'introduce and one breath to do it in. Both halves play their own stretch of the same ' +
        'recording, so nothing is re-encoded and no footage is lost. Narration already on the ' +
        'clip stays with the first half.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline'),
        atSeconds: z
          .number()
          .positive()
          .describe('Where to cut, in seconds from the start of that clip')
      }
    },
    async ({ projectId, timelineItemId, atSeconds }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)

      // Bounds checked here rather than left to the API, which counts frames on the project's
      // own timeline — an agent that asked in seconds inside one clip cannot act on that.
      const seconds = item.duration / 30
      if (atSeconds >= seconds) {
        return text(
          `That clip is only ${seconds.toFixed(1)}s long, so it cannot be cut at ${atSeconds.toFixed(1)}s.`
        )
      }

      // The API cuts at a frame on the project's own timeline; the agent is talking about a
      // moment inside this clip, which is the more natural thing to know.
      const atFrame = item.start + Math.round(atSeconds * 30)
      const halves = withHistory(
        projectId,
        () => splitTimelineItem(projectId, timelineItemId, atFrame, baseDir),
        baseDir
      )

      return text(
        `Split into two clips:\n` +
          halves.map((half) => `  ${half.id} — ${(half.duration / 30).toFixed(1)}s`).join('\n') +
          '\nGive the second one words with talkie_set_narration or talkie_draft_narration.'
      )
    }
  )

  tool(
    'talkie_draft_narration',
    {
      title: 'Draft narration',
      description:
        'Have Talkie’s own narration provider write the words, from what the clip actually shows. ' +
        'Leave out timelineItemId to draft every clip that has none. Words already written by ' +
        'hand are never replaced.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().optional()
      }
    },
    async ({ projectId, timelineItemId }) => {
      if (timelineItemId) {
        const result = await withHistory(
          projectId,
          () => draftNarrationForItem(projectId, timelineItemId, {}, baseDir),
          baseDir
        )
        return text(
          result.status === 'drafted'
            ? `Drafted with ${result.providerId}:\n${result.text}`
            : `${result.status}: ${result.reason ?? 'no reason given'}`
        )
      }

      const results = await draftNarrationForProject(projectId, {}, baseDir)
      const drafted = results.filter((r) => r.status === 'drafted').length
      const failed = results.filter((r) => r.status === 'failed')

      return text(
        `Drafted ${drafted} of ${results.length} clip(s).` +
          (failed.length > 0 ? `\nFailed: ${failed.map((f) => f.reason).join('; ')}` : '')
      )
    }
  )

  tool(
    'talkie_narrate',
    {
      title: 'Speak the narration',
      description:
        'Turn written narration into audio with the configured voice. Leave out timelineItemId to ' +
        'voice every clip that has words but no audio yet.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().optional()
      }
    },
    async ({ projectId, timelineItemId }) => {
      const transcript = readTranscript(projectId, baseDir)
      const wanted = timelineItemId
        ? transcript.filter((s) => s.timelineItemId === timelineItemId)
        : transcript.filter((s) => s.text.trim() && s.status !== 'narrated')

      if (wanted.length === 0) return text('Nothing to voice: every clip with words already has audio.')

      const spoken: string[] = []
      for (const segment of wanted) {
        await narrateSegment(projectId, segment.id, baseDir)
        spoken.push(segment.id)
      }

      return text(`Voiced ${spoken.length} clip(s).`)
    }
  )

  // ------------------------------------------------------------------ export

  tool(
    'talkie_export',
    {
      title: 'Export the video',
      description:
        'Render the project to an MP4 with its narration mixed in. This takes a while on a long ' +
        'demo. Returns the path to the finished file.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => {
      const path = await renderProjectVideo(projectId, baseDir)
      return text(`Exported to ${path}`)
    }
  )

  return server
}
