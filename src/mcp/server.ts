import { homedir } from 'os'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createProject,
  listProjectOverviews,
  readTimeline,
  readTranscript,
  addScene,
  addTranscriptSegment,
  updateTranscriptSegmentText
} from '../main/project/projectApi'
import { withHistory } from '../main/project/history'
import { draftNarrationForItem, draftNarrationForProject } from '../main/agent/draftNarration'
import { narrateSegment } from '../main/transcript/narrate'
import { renderProjectVideo } from '../main/render/renderProject'
import { richTextToPlain } from '../main/project/timeline/richText'
import { SceneStyleSchema } from '../main/project/timeline/schema'
import type { TimelineItem } from '../main/project/timeline/schema'
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
  const data = item.data as { title?: string; source?: string } | null
  const name =
    item.kind === 'scene' || item.kind === 'diagram'
      ? richTextToPlain(data?.title ?? '') || 'untitled'
      : item.kind

  return `${index + 1}. ${item.kind} — ${name} (${seconds}s, id ${item.id})`
}

export function createTalkieServer(baseDir: string = talkieHome()): McpServer {
  const server = new McpServer({ name: 'talkie', version: '1.0.0' })

  // ---------------------------------------------------------------- projects

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
        const narration = segment ? `\n   narration (${segment.status}): ${segment.text}` : '\n   no narration yet'
        return describeItem(item, index) + narration
      })

      return text(lines.join('\n'))
    }
  )

  // --------------------------------------------------------------- recording

  server.registerTool(
    'talkie_start_recording',
    {
      title: 'Start recording',
      description:
        'Open a real browser window and start recording it. Drive it with talkie_navigate, ' +
        'talkie_click, talkie_type and talkie_scroll, then call talkie_stop_recording to put the ' +
        'clip on the timeline. One recording at a time.',
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

  server.registerTool(
    'talkie_navigate',
    {
      title: 'Go to a page',
      description: 'Navigate the recorded browser to a URL.',
      inputSchema: { url: z.string() },
      annotations: { openWorldHint: true }
    },
    async ({ url }) => text(`Now at ${await recording.navigate(url)}`)
  )

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
    'talkie_stop_recording',
    {
      title: 'Stop recording',
      description: 'Close the browser and add what was recorded to the project timeline.',
      inputSchema: {}
    },
    async () => {
      const item = await recording.finishRecording(baseDir)
      return text(
        `Recording added to the timeline: ${(item.duration / 30).toFixed(1)}s (clip id ${item.id}).\n` +
          'Give it words with talkie_set_narration or talkie_draft_narration.'
      )
    }
  )

  server.registerTool(
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

  server.registerTool(
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
      return text(`Added the slide "${title}" (clip id ${item.id}).`)
    }
  )

  // --------------------------------------------------------------- narration

  server.registerTool(
    'talkie_set_narration',
    {
      title: 'Write narration',
      description:
        'Set the words spoken over one clip. Roughly 2.5 words a second — going long means the ' +
        'voice runs past the clip. Call talkie_narrate afterwards to turn it into audio.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline'),
        text: z.string()
      }
    },
    async ({ projectId, timelineItemId, text: words }) => {
      const existing = readTranscript(projectId, baseDir).find((s) => s.timelineItemId === timelineItemId)

      const segment = withHistory(
        projectId,
        () =>
          existing
            ? updateTranscriptSegmentText(projectId, existing.id, words, baseDir)
            : addTranscriptSegment(projectId, { text: words, timelineItemId }, baseDir),
        baseDir
      )

      return text(`Narration set (segment id ${segment.id}).`)
    }
  )

  server.registerTool(
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

  server.registerTool(
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

  server.registerTool(
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
