import { readFileSync } from 'fs'
import { homedir } from 'os'
import { basename, isAbsolute } from 'path'
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
import { activeVersion, playable } from '../main/project/versions'
import {
  chooseVersion,
  createVersion,
  deleteVersion,
  readVersions,
  renameVersion,
  setClipIncluded
} from '../main/project/versionsStore'
import { rasterisePdf } from '../main/slides/rasterisePdf'
import { drawDiagramForProject } from '../main/themes/projectDiagrams'
import {
  addFontInto,
  createTheme,
  deleteTheme,
  describeFontFiles,
  duplicateTheme,
  findThemeDir,
  listThemes,
  projectsUsingTheme,
  readTheme,
  updateTheme,
  writeThemeAsset
} from '../main/themes/themeApi'
import { describeFace } from '../main/themes/fontFace'
import { isBuiltinThemeId } from '../main/themes/builtinThemes'
import { BUILTIN_FONTS, LOGO_CORNERS, ThemeDraftSchema, VARIANT_IDS, defaultThemeDraft, type FontChoice, type Theme } from '../main/themes/schema'
import { resolveFonts } from '../main/themes/generate/resolveFonts'
import { readSettings } from '../main/settings/settingsStore'
import { speechEngine } from '../main/tts/engineRegistry'
import { fixContrast } from '../main/themes/contrast'
import { setProjectTheme } from '../main/themes/applyTheme'
import { generateTheme, saveGeneratedTheme } from '../main/themes/generate/generateTheme'
import { undo, redo } from '../main/project/history'
import { ProjectContextSchema } from '../main/project/projectContext'
import { checkMcpAccess, explainRefusal } from '../main/settings/mcpAccess'
import { addHtmlScene, checkSceneItem, editHtmlScene, readHtmlScene } from '../main/htmlScene/htmlSceneApi'
import { listTemplates, templateFiles } from '../main/htmlScene/templates'
import { HTML_SCENE_GUIDE } from '../main/htmlScene/guide'
import type { CheckResult } from '../main/htmlScene/check'
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
    item.kind === 'scene' || item.kind === 'diagram' || item.kind === 'html'
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
/**
 * What `style` means, said once. "theme" is the one that changed meaning: in a themed project its
 * three values are the theme's own variants, and accent and font give way to the theme's.
 */
const STYLE_HELP =
  'Look: theme "dark", "light" or "brand" — in a project with a theme these are that theme\'s three ' +
  'variants (brand opens a section, light explains, dark sets a scene). font (serif/sans) and accent ' +
  'only apply to a project without a theme. align left/center; size regular/large.'

const LayoutInput = z
  .enum(['standard', 'title', 'closing'])
  .describe('"title" and "closing" draw the large opening and closing cards, with the theme\'s logo; "standard" is an ordinary slide')

/** A file the agent names, read only if it is plainly a path on this machine. */
function readLocalFile(path: string): { bytes: Buffer; fileName: string } {
  if (!isAbsolute(path)) throw new Error(`"${path}" is not an absolute path.`)
  return { bytes: readFileSync(path), fileName: basename(path) }
}

async function draw(
  projectId: string,
  source: string,
  data: unknown,
  baseDir: string
): Promise<{ ok: true; svg: string; themeStamp?: string } | { ok: false; reason: string }> {
  try {
    // In the project's theme, so an agent's diagram arrives in the colours of the slides around it.
    return { ok: true, ...(await drawDiagramForProject(projectId, source, data, baseDir)) }
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
      const cut = activeVersion(readVersions(projectId, baseDir))
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
              segment.beats.map((beat) => `     [${beat.at.toFixed(1)}] ${beat.text.replace(/\s*\n\s*/g, ' / ')}`).join('\n')
            : `\n   narration (${segment.status}), read straight through: ${segment.text}`
          : '\n   no narration yet'
        const out = cut.leftOut.includes(item.id) ? `\n   LEFT OUT of the version "${cut.name}": not played or exported` : ''
        return describeItem(item, index) + out + narration
      })

      // Which version is being worked on decides what plays and what export writes.
      const versions = readVersions(projectId, baseDir)
      const heading =
        versions.versions.length > 1 || cut.leftOut.length > 0
          ? `Working on the version "${cut.name}" (${versions.versions.length} version${versions.versions.length === 1 ? '' : 's'}; see talkie_versions).\n`
          : ''
      return text(heading + lines.join('\n'))
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
          `Theme: ${themeLabel(project.themeId)}`,
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
    'talkie_list_voices',
    {
      title: 'List voices',
      description:
        'The voices a project can be read in, for whichever speech engine Talkie is set to — the ' +
        'Mac\'s own voices, or Kokoro, the built-in voice that sounds close to a person. The engine ' +
        'is chosen by the person in Settings, not here.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const { engine: engineId, voice: appVoice } = readSettings(baseDir).speech
      const engine = speechEngine(engineId)
      const [voices, availability] = await Promise.all([engine.voices(), engine.isAvailable()])
      return text(
        [
          `Engine: ${engine.label}${availability.available ? '' : ` — not ready: ${availability.reason ?? 'unavailable'}`}`,
          `Talkie's own voice: ${appVoice || 'the default'}`,
          '',
          ...voices.map((voice) => `${voice.name}${voice.locale ? ` (${voice.locale})` : ''}`)
        ].join('\n')
      )
    }
  )

  tool(
    'talkie_set_voice',
    {
      title: 'Choose the voice',
      description:
        'Set the voice this project is read in, by name — one from talkie_list_voices, for the engine ' +
          'Talkie is set to. ' +
        'Narration already recorded keeps the voice it was read in until it is voiced again.',
      inputSchema: {
        projectId: z.string(),
        voice: z.string().describe('A voice name, or empty to follow whatever Talkie is set to')
      }
    },
    async ({ projectId, voice }) => {
      // A name the engine does not have is read in its default voice, silently — so it is refused
      // here, where whoever chose it can still choose again.
      const wanted = voice.trim()
      if (wanted) {
        const voices = await speechEngine(readSettings(baseDir).speech.engine).voices().catch(() => [])
        // The Mac lists "Daniel (English (UK))" and answers to "Daniel", so either is a match.
        const known = voices.some((v) => [v.name, v.name.split(' (')[0]].some((name) => name.toLowerCase() === wanted.toLowerCase()))
        if (voices.length > 0 && !known) {
          return text(`Talkie has no voice called ${wanted} with its current engine. talkie_list_voices names the ones it has.`)
        }
      }
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

  /** A project's theme by name, or why there is none — a theme deleted from under it included. */
  const themeLabel = (themeId: string | undefined): string => {
    if (!themeId) return "none — Talkie's own look (talkie_apply_theme sets one)"
    try {
      return `${readTheme(themeId, baseDir).name} (theme id ${themeId})`
    } catch {
      return "none — its theme was deleted, so it draws in Talkie's own look"
    }
  }

  // Themes: what a company's videos look like, kept once in a library and chosen per project.
  // All five verbs, as for every other kind — see AGENTS.md.
  const VariantInput = z
    .object({ background: z.string(), heading: z.string(), body: z.string(), accent: z.string() })
    .partial()
  const FontInput = z.object({
    family: z.string().optional().describe('Left out when files are given: the family is read from inside them'),
    files: z
      .array(z.string())
      .optional()
      .describe('Absolute paths to the company\'s own .otf, .ttf, .woff or .woff2 files — every weight and style it uses')
  })
  const FONT_HELP =
    `"${BUILTIN_FONTS.sans}" and "${BUILTIN_FONTS.serif}" are Talkie's own. A company's own font: give its files, ` +
    'each read for its family, weight and slant (a file that is not a font is refused). Any other family is ' +
    'fetched from Google Fonts if it is open there.'

  /**
   * A font for a theme, as the editor would make it: Talkie's own by name, the person's files as
   * given, or an open family fetched from Google Fonts — and Talkie's own, said so, if none of those.
   */
  const chooseFont = async (
    themeId: string,
    role: 'heading' | 'body',
    wanted: z.infer<typeof FontInput>,
    notes: string[]
  ): Promise<FontChoice> => {
    if (wanted.family && (Object.values(BUILTIN_FONTS) as string[]).includes(wanted.family)) {
      return { family: wanted.family, source: 'builtin', files: [] }
    }
    if (wanted.files?.length) {
      // Read as they are saved, as the editor does: the family names itself, a file that is not a
      // font is turned away, and the agent is told which faces it now has — a missing bold shows.
      const dir = findThemeDir(themeId, baseDir)
      if (!dir) throw new Error(`No theme with id ${themeId}.`)
      const faces = wanted.files.map((path) => {
        const { fileName, bytes } = readLocalFile(path)
        return addFontInto(dir, fileName, bytes)
      })
      const family = wanted.family?.trim() || faces[0].family
      notes.push(`${role === 'heading' ? 'Headings' : 'Text'}: ${family}, ${faces.map((face) => face.variable ? `${face.face} (every weight)` : describeFace(face.weight, face.italic)).join(', ')}.`)
      return { family, source: 'user', files: faces.map((face) => face.file) }
    }
    if (!wanted.family) throw new Error(`Name a family for the ${role} font, or give its files.`)
    const probe = defaultThemeDraft('font')
    probe.fonts[role] = { family: wanted.family, source: 'google', files: [] }
    const resolved = await resolveFonts(probe, {})
    for (const file of resolved.files.filter((f) => f.role === role)) {
      writeThemeAsset(themeId, 'font', basename(file.fileName), file.bytes, baseDir)
    }
    notes.push(...resolved.notes)
    return resolved.draft.fonts[role]
  }

  /** A font as the person would check it: the family, and for their own files, each face they cover. */
  const describeFont = (theme: Theme, role: 'heading' | 'body'): string => {
    const choice = theme.fonts[role]
    if (choice.source !== 'user') return `${choice.family} (${choice.source === 'google' ? 'open font' : 'built in'})`
    const dir = findThemeDir(theme.id, baseDir)
    const faces = dir ? describeFontFiles(dir, choice.files) : []
    return `${choice.family} (the company's own: ${faces.map((face) => (face.variable ? `${face.face}, every weight` : describeFace(face.weight, face.italic))).join(', ') || 'files missing'})`
  }

  const describeTheme = (theme: Theme): string =>
    [
      `${theme.name} (theme id ${theme.id})`,
      theme.company && `Company: ${theme.company}`,
      theme.tagline && `Tagline: ${theme.tagline}`,
      theme.website && `Website: ${theme.website}`,
      ...VARIANT_IDS.map((id) => {
        const v = theme.variants[id]
        return `${id}: background ${v.background}, heading ${v.heading}, body ${v.body}, accent ${v.accent}`
      }),
      `Fonts: ${describeFont(theme, 'heading')} for headings, ${describeFont(theme, 'body')} for text`,
      `Logo: ${theme.logo ? `${theme.logo.file}, ${theme.logo.corner}` : 'none'}`,
      `Click highlight ${theme.overlays.highlight}; captions in the ${theme.overlays.caption} variant`,
      ...(theme.provenance?.notes.length ? ['Notes from when it was made:', ...theme.provenance.notes.map((n) => `  - ${n}`)] : [])
    ]
      .filter(Boolean)
      .join('\n')

  tool(
    'talkie_list_themes',
    {
      title: 'List themes',
      description: 'The themes in the library — each a company\'s colours, fonts and logo for its videos.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => {
      const themes = listThemes(baseDir)
      return text(
        themes.length === 0
          ? 'No themes yet. talkie_create_theme makes one, from a website if you have one.'
          : themes
              .map((t) => `${t.name}${t.company ? ` — ${t.company}` : ''} (${isBuiltinThemeId(t.id) ? 'built in, ' : ''}theme id ${t.id})`)
              .join('\n')
      )
    }
  )

  tool(
    'talkie_theme',
    {
      title: 'Read a theme',
      description: 'Everything a theme sets, and which projects use it.',
      inputSchema: { themeId: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ themeId }) => {
      const using = projectsUsingTheme(themeId, baseDir).map((p) => p.name)
      return text(`${describeTheme(readTheme(themeId, baseDir))}\nUsed by: ${using.join(', ') || 'no project'}`)
    }
  )

  tool(
    'talkie_create_theme',
    {
      title: 'Make a theme',
      description:
        'Make a theme for a company. Give a website (its real colours, fonts and logo are read from ' +
        'it), a logo or brand-guide file, or a description, and the theme is designed from that — ' +
        'this can take half a minute. Talkie also comes with built-in themes (talkie_list_themes) ' +
        'that can be applied as they are, or copied with talkie_duplicate_theme. ' +
        'Give neither and it starts from Talkie\'s own look with whatever fields are given. Colours ' +
        'are checked for readability either way.',
      inputSchema: {
        name: z.string(),
        url: z.string().optional().describe('The company\'s website'),
        description: z.string().optional().describe('What the company is and how it should feel'),
        file: z
          .string()
          .optional()
          .describe('An absolute path to the company\'s logo (svg, png, jpg, webp) or a PDF of its brand guidelines'),
        company: z.string().optional(),
        tagline: z.string().optional(),
        website: z.string().optional()
      }
    },
    async ({ name, url, description, file, company, tagline, website }) => {
      let theme: Theme
      if (url || description || file) {
        const { draft, stagingDir } = await generateTheme(
          { name, url, description, ...(file ? { file: readLocalFile(file) } : {}) },
          { baseDir }
        )
        theme = saveGeneratedTheme(
          { ...draft, ...(company ? { company } : {}), ...(tagline ? { tagline } : {}), ...(website ? { website } : {}) },
          stagingDir,
          baseDir
        )
      } else {
        theme = createTheme({ ...defaultThemeDraft(name), company: company ?? name, tagline: tagline ?? '', website: website ?? '' }, baseDir)
      }
      return text(`Made it.\n${describeTheme(theme)}\n\ntalkie_apply_theme puts it on a project.`)
    }
  )

  tool(
    'talkie_update_theme',
    {
      title: 'Change a theme',
      description:
        'Change some of a theme — colours, fonts, logo, words, overlays. Only what is given changes. ' +
          'Built-in themes cannot be changed; duplicate one first. Every project using the theme follows ' +
        'the change; colours are checked for readability and adjusted if they would be hard to read.',
      inputSchema: {
        themeId: z.string(),
        name: z.string().optional(),
        company: z.string().optional(),
        tagline: z.string().optional(),
        website: z.string().optional(),
        brand: VariantInput.optional().describe('Colours of the brand variant, as #rrggbb'),
        light: VariantInput.optional(),
        dark: VariantInput.optional(),
        highlight: z.string().optional().describe('Click highlight colour for new recordings'),
        caption: z.enum(VARIANT_IDS).optional().describe('Which variant the caption bar is drawn in'),
        headingFont: FontInput.optional().describe('The family for titles. ' + FONT_HELP),
        bodyFont: FontInput.optional().describe('The family for text. ' + FONT_HELP),
        logo: z
          .object({
            path: z.string().optional().describe('An absolute path to an svg, png, jpg or webp, under 2 MB'),
            corner: z.enum(LOGO_CORNERS).optional(),
            onRecordings: z.boolean().optional(),
            onSlides: z.boolean().optional(),
            remove: z.boolean().optional().describe('Take the logo off the theme')
          })
          .optional()
      }
    },
    async ({ themeId, name, company, tagline, website, brand, light, dark, highlight, caption, headingFont, bodyFont, logo }) => {
      const current = readTheme(themeId, baseDir)
      if (isBuiltinThemeId(themeId)) {
        return text(`${current.name} is built into Talkie and cannot be changed. talkie_duplicate_theme makes a copy that can.`)
      }
      const notes: string[] = []

      // Files first, so a refusal — a built-in theme, a file that is not a picture — leaves the
      // theme as it was rather than half-changed.
      const fonts = { ...current.fonts }
      for (const [role, wanted] of [['heading', headingFont], ['body', bodyFont]] as const) {
        if (!wanted) continue
        const chosen = await chooseFont(themeId, role, wanted, notes)
        fonts[role] = chosen
      }
      let nextLogo = current.logo
      if (logo?.remove) nextLogo = undefined
      else if (logo) {
        const picked = logo.path ? readLocalFile(logo.path) : undefined
        const file = picked ? writeThemeAsset(themeId, 'logo', picked.fileName, picked.bytes, baseDir) : current.logo?.file
        if (!file) return text('That theme has no logo yet, so give a path to one.')
        nextLogo = {
          file,
          corner: logo.corner ?? current.logo?.corner ?? 'bottom-right',
          showOn: {
            recordings: logo.onRecordings ?? current.logo?.showOn.recordings ?? true,
            slides: logo.onSlides ?? current.logo?.showOn.slides ?? true
          }
        }
      }

      const fixed = fixContrast(
        ThemeDraftSchema.parse({
          ...current,
          ...(name !== undefined ? { name } : {}),
          ...(company !== undefined ? { company } : {}),
          ...(tagline !== undefined ? { tagline } : {}),
          ...(website !== undefined ? { website } : {}),
          variants: {
            brand: { ...current.variants.brand, ...brand },
            light: { ...current.variants.light, ...light },
            dark: { ...current.variants.dark, ...dark }
          },
          overlays: {
            highlight: highlight ?? current.overlays.highlight,
            caption: caption ?? current.overlays.caption
          },
          fonts,
          logo: nextLogo
        })
      )
      notes.push(...fixed.notes)
      const theme = updateTheme(themeId, fixed.draft, baseDir)
      return text(`Changed.${notes.length ? `\n${notes.join('\n')}` : ''}\n${describeTheme(theme)}`)
    }
  )

  tool(
    'talkie_duplicate_theme',
    {
      title: 'Copy a theme',
      description:
        'Make an editable copy of a theme, logo and fonts included — how a built-in theme is made ' +
        'into a company\'s own, or one company\'s theme becomes the start of another\'s.',
      inputSchema: { themeId: z.string(), name: z.string().optional().describe('A name for the copy') }
    },
    async ({ themeId, name }) => {
      let theme = duplicateTheme(themeId, baseDir)
      if (name?.trim()) theme = updateTheme(theme.id, { ...theme, name: name.trim() }, baseDir)
      return text(`Copied.\n${describeTheme(theme)}\n\ntalkie_update_theme changes it; talkie_apply_theme puts it on a project.`)
    }
  )

  tool(
    'talkie_delete_theme',
    {
      title: 'Delete a theme',
      description:
        'Remove a theme from the library for good. Projects using it go back to Talkie\'s own look; ' +
        'their opening and closing cards stay. This cannot be undone.',
      inputSchema: { themeId: z.string() },
      annotations: { destructiveHint: true }
    },
    async ({ themeId }) => {
      const theme = readTheme(themeId, baseDir)
      const using = projectsUsingTheme(themeId, baseDir)
      deleteTheme(themeId, baseDir)
      return text(
        `Deleted ${theme.name}.` +
          (using.length ? ` ${using.map((p) => p.name).join(', ')} went back to Talkie's own look.` : '')
      )
    }
  )

  tool(
    'talkie_apply_theme',
    {
      title: 'Use a theme for a project',
      description:
        'Draw a project\'s video in a theme, or pass no themeId to go back to Talkie\'s own look. ' +
        'The first theme a project gets also adds an opening card and a closing card — ordinary ' +
        'slides, at the start and the end — and never again after that.',
      inputSchema: { projectId: z.string(), themeId: z.string().optional() }
    },
    async ({ projectId, themeId }) => {
      const before = readTimeline(projectId, baseDir).length
      withHistory(projectId, () => setProjectTheme(projectId, themeId ?? null, baseDir), baseDir)
      const added = readTimeline(projectId, baseDir).length - before
      return text(
        themeId
          ? `The project now follows ${readTheme(themeId, baseDir).name}.${added ? ' Added an opening card and a closing card.' : ''} Diagrams are redrawn in its colours when the project is next opened or exported.`
          : 'The project is back to Talkie\'s own look.'
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

  // ---------------------------------------------------------------- versions

  const describeVersions = (projectId: string): string => {
    const versions = readVersions(projectId, baseDir)
    const timeline = readTimeline(projectId, baseDir)
    const name = (clipId: string): string => {
      const index = timeline.findIndex((item) => item.id === clipId)
      return index === -1 ? 'a clip no longer there' : `clip ${index + 1} (${clipId})`
    }
    return versions.versions
      .map((version) => {
        const frames = playable(timeline, version.leftOut).reduce((end, item) => Math.max(end, item.start + item.duration), 0)
        const marker = version.id === versions.active ? ' — being worked on' : ''
        const out = version.leftOut.length ? `leaves out ${version.leftOut.map(name).join(', ')}` : 'plays every clip'
        return `"${version.name}" (id ${version.id})${marker}: ${(frames / 30).toFixed(1)}s, ${out}`
      })
      .join('\n')
  }

  tool(
    'talkie_versions',
    {
      title: 'The versions of a project',
      description:
        'A project can be cut several ways from the same clips — the full walkthrough, a two-minute ' +
        'one, one for a particular audience. Each version leaves some clips out; one is being worked ' +
        'on, and it is what the preview plays and talkie_export writes. Left-out clips stay in the ' +
        'project and can be put back. Lists every version, how long it runs, and what it leaves out.',
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ projectId }) => text(describeVersions(projectId))
  )

  tool(
    'talkie_include_clip',
    {
      title: 'Put a clip in the version, or leave it out',
      description:
        'Leave a clip out of the version being worked on, or put it back. Nothing is deleted: the ' +
        'clip and its narration stay in the project, and other versions are not changed. To make a ' +
        'shorter cut without losing the full one, make a version with talkie_create_version first.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string().describe('The clip id, from talkie_timeline'),
        included: z.boolean().describe('false leaves it out of this version; true puts it back')
      }
    },
    async ({ projectId, timelineItemId, included }) => {
      if (!readTimeline(projectId, baseDir).some((item) => item.id === timelineItemId)) return text(`No clip found with id ${timelineItemId}.`)
      withHistory(projectId, () => setClipIncluded(projectId, timelineItemId, included, baseDir), baseDir)
      return text(describeVersions(projectId))
    }
  )

  tool(
    'talkie_create_version',
    {
      title: 'Make a new version',
      description:
        'Make a new version of the project, starting as a copy of the one being worked on, and work ' +
        'on it from now — so leaving clips out of it does not change the version it came from.',
      inputSchema: { projectId: z.string(), name: z.string().describe('What this cut is, e.g. "2-minute" or "For sales"') }
    },
    async ({ projectId, name }) => {
      withHistory(projectId, () => createVersion(projectId, name, baseDir), baseDir)
      return text(describeVersions(projectId))
    }
  )

  tool(
    'talkie_choose_version',
    {
      title: 'Work on another version',
      description: 'Switch to another version: it becomes what the preview plays and what talkie_export writes.',
      inputSchema: { projectId: z.string(), versionId: z.string().describe('From talkie_versions') }
    },
    async ({ projectId, versionId }) => {
      withHistory(projectId, () => chooseVersion(projectId, versionId, baseDir), baseDir)
      return text(describeVersions(projectId))
    }
  )

  tool(
    'talkie_rename_version',
    {
      title: 'Rename a version',
      description: 'Give a version another name. Names are kept distinct; a taken one gets a number.',
      inputSchema: { projectId: z.string(), versionId: z.string().describe('From talkie_versions'), name: z.string() }
    },
    async ({ projectId, versionId, name }) => {
      withHistory(projectId, () => renameVersion(projectId, versionId, name, baseDir), baseDir)
      return text(describeVersions(projectId))
    }
  )

  tool(
    'talkie_delete_version',
    {
      title: 'Delete a version',
      description:
        'Remove a version. Its clips are not touched — only the record of which it left out. The ' +
        'last version cannot be deleted.',
      inputSchema: { projectId: z.string(), versionId: z.string().describe('From talkie_versions') }
    },
    async ({ projectId, versionId }) => {
      withHistory(projectId, () => deleteVersion(projectId, versionId, baseDir), baseDir)
      return text(describeVersions(projectId))
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
      title: 'Add a classic slide',
      description:
        'Add one of Talkie\'s classic text slides to the end of the timeline. New scenes in Talkie are HTML ' +
        'scenes: for a slide, use talkie_add_html_scene with template "slide" (or "quote"), which is what the ' +
        'person adds and edits in the app. Use this only for a theme\'s opening or closing card (layout), or ' +
        'when asked for a classic slide. Keep the lines short: they are read on screen, not aloud.',
      inputSchema: {
        projectId: z.string(),
        title: z.string(),
        bullets: z.array(z.string()).optional().describe('A few short lines, or none at all'),
        style: SceneStyleSchema.partial().optional().describe(STYLE_HELP),
        layout: LayoutInput.optional()
      }
    },
    async ({ projectId, title, bullets, style, layout }) => {
      const item = withHistory(
        projectId,
        () => addScene(projectId, 'scene', { title, bullets: bullets ?? [], style: style ?? {}, ...(layout ? { layout } : {}) }, baseDir),
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

  // ---------------------------------------------------------------- HTML scenes
  // A page drawn into the video frame by frame. Every change is checked headless and the frames
  // come back as pictures, so an agent sees what it made before anyone watches it.

  /** The check's verdict, and the frames themselves as images. */
  const sceneReply = (said: string, check: CheckResult, warnings: string[] = []) => ({
    content: [
      {
        type: 'text' as const,
        text: [
          said,
          ...warnings.map((warning) => `Warning: ${warning}`),
          check.problems.length ? `Problems to fix:\n${check.problems.map((p) => `- ${p}`).join('\n')}` : 'The check found nothing wrong.',
          check.frames.length ? `Frames at ${check.frames.map((f) => `${f.atSeconds.toFixed(1)}s`).join(', ')}:` : ''
        ]
          .filter(Boolean)
          .join('\n')
      },
      ...check.frames.slice(0, 6).map((frame) => ({ type: 'image' as const, data: frame.png.toString('base64'), mimeType: 'image/png' }))
    ]
  })
  const HtmlLook = z.object({ theme: z.enum(['brand', 'light', 'dark']).optional() })
  const absolute = (path: string): string => {
    if (!isAbsolute(path)) throw new Error(`"${path}" is not an absolute path.`)
    return path
  }

  tool(
    'talkie_html_scene_guide',
    {
      title: 'How to write an HTML scene',
      description:
        'Read this before writing an HTML scene: the runtime API (talkie.time, onFrame, params, beats), ' +
        'the theme variables every scene must use, the libraries available, and the rules.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () => text(HTML_SCENE_GUIDE)
  )

  tool(
    'talkie_add_html_scene',
    {
      title: 'Add an HTML scene',
      description:
        'Put a scene on the timeline — the way every new scene is made in Talkie, slides and diagrams ' +
        'included. Easiest: template (an id from talkie_html_templates — slide, steps, timeline, quote, ' +
        'bar-chart…) with params, the values it declares, changed to say what this scene says; values left ' +
        'out keep the template\'s. Or write a page: files (path → contents, at least index.html, declaring ' +
        'its values in a talkie-values block), or path: an absolute .html file or folder to import. Read ' +
        'talkie_html_scene_guide before writing one. Returns what the check found and the frames it drew.',
      inputSchema: {
        projectId: z.string(),
        title: z.string(),
        template: z.string().optional().describe('A template id from talkie_html_templates, instead of files or path'),
        files: z.record(z.string()).optional().describe('Files by path inside the scene, e.g. {"index.html": "..."}'),
        path: z.string().optional().describe('An absolute path to an .html file or a folder to import instead'),
        params: z.record(z.unknown()).optional().describe('Named values the page reads as talkie.params'),
        style: HtmlLook.optional().describe(STYLE_HELP),
        durationSeconds: z.number().positive().optional(),
        position: z.number().int().min(1).optional().describe('Where on the timeline, counting from 1 as talkie_timeline does; the end if left out'),
        prompt: z.string().optional().describe('What it was made to show, kept for later changes and for narration')
      }
    },
    async ({ projectId, title, template, files, path, params, style, durationSeconds, position, prompt }) => {
      if (!template && !files && !path) return text('Give a template, files, or a path to import.')
      const starting = template ? listTemplates().find((each) => each.id === template) : undefined
      if (template && !starting) {
        return text(`There is no template called ${template}. talkie_html_templates lists them: ${listTemplates().map((each) => each.id).join(', ')}.`)
      }
      const outcome = await addHtmlScene(
        projectId,
        {
          title,
          ...(starting ? { files: templateFiles(starting.id) as Record<string, string> } : files ? { files } : {}),
          ...(path && !starting ? { importPath: absolute(path) } : {}),
          // A template's values, with whatever was given over them.
          params: starting ? { ...starting.values, ...(params ?? {}) } : params,
          style,
          prompt,
          position,
          ...(durationSeconds ? { durationFrames: Math.round(durationSeconds * 30) } : {})
        },
        baseDir
      )
      return sceneReply(`Added "${title}" (clip id ${outcome.item.id}).`, outcome.check, outcome.warnings)
    }
  )

  tool(
    'talkie_html_templates',
    {
      title: 'Templates for scenes',
      description:
        'The ready-made scenes a new one can start from — slides, diagrams (steps, timeline), data (charts, ' +
        'counters), motion and code — each in the project\'s theme, timed to its narration, and with the ' +
        'values it reads. Start a scene from one with talkie_add_html_scene (template, params): it is what ' +
        'the app adds, so the person edits it the same way, through a form.',
      inputSchema: {},
      annotations: { readOnlyHint: true }
    },
    async () =>
      text(
        listTemplates()
          .map((template) => `${template.id} (${template.category}) — ${template.name}: ${template.description}\n   values: ${JSON.stringify(template.values)}`)
          .join('\n')
      )
  )

  tool(
    'talkie_html_scene',
    {
      title: 'Read an HTML scene',
      description: 'An HTML scene\'s files, values, look, what it was made to show, and what the last check found.',
      inputSchema: { projectId: z.string(), timelineItemId: z.string() },
      annotations: { readOnlyHint: true }
    },
    async ({ projectId, timelineItemId }) => {
      const { data, files } = readHtmlScene(projectId, timelineItemId, baseDir)
      return text(
        [
          `${data.title} (clip id ${timelineItemId}), look: ${data.style.theme}`,
          data.prompt ? `Made to show: ${data.prompt}` : '',
          `Values: ${JSON.stringify(data.params)}`,
          data.check?.problems.length ? `Last check:\n${data.check.problems.map((p) => `- ${p}`).join('\n')}` : 'Last check: nothing wrong.',
          '',
          ...files.map((file) => (file.text === undefined ? `=== ${file.path} === (${file.bytes} bytes, not text)` : `=== ${file.path} ===\n${file.text}`))
        ]
          .filter((line) => line !== '')
          .join('\n')
      )
    }
  )

  tool(
    'talkie_edit_html_scene',
    {
      title: 'Change an HTML scene',
      description:
        'Change an HTML scene: replace or add files, remove files, or change its title, values or look. ' +
        'Only what is given changes. One undo step. Returns what the check found and the frames it drew.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string(),
        files: z.record(z.string()).optional(),
        removeFiles: z.array(z.string()).optional(),
        title: z.string().optional(),
        params: z.record(z.unknown()).optional(),
        style: HtmlLook.optional().describe(STYLE_HELP)
      }
    },
    async ({ projectId, timelineItemId, files, removeFiles, title, params, style }) => {
      const outcome = await editHtmlScene(projectId, timelineItemId, { files, removeFiles, title, params, style }, baseDir)
      return sceneReply('Changed.', outcome.check)
    }
  )

  tool(
    'talkie_check_html_scene',
    {
      title: 'Look at an HTML scene',
      description:
        'Draw an HTML scene at the moments asked for and return the frames as pictures, with anything wrong: ' +
        'errors, attempts to leave the sandbox, colours not from the theme, text out of frame, animation that ' +
        'depends on frame order. By default the start, each line of narration, and the end.',
      inputSchema: {
        projectId: z.string(),
        timelineItemId: z.string(),
        atSeconds: z.array(z.number().min(0)).optional()
      },
      annotations: { readOnlyHint: true }
    },
    async ({ projectId, timelineItemId, atSeconds }) =>
      sceneReply('Checked.', await checkSceneItem(projectId, timelineItemId, atSeconds, baseDir))
  )

  tool(
    'talkie_add_diagram',
    {
      title: 'Add a mermaid diagram',
      description:
        'Add a diagram written as mermaid source. For a few steps in order, or dates along a line, use ' +
        'talkie_add_html_scene with template "steps" or "timeline" instead — what the person adds and edits ' +
        'in the app. Mermaid is for structures those cannot hold: a sequence, an architecture, a branching ' +
        'flow. Better than describing a structure in words over a screen recording that does not show it. ' +
        'It is drawn straight away, so a syntax error comes back here rather than surfacing as ' +
        'a blank clip later. The source is kept, so it stays editable.',
      inputSchema: {
        projectId: z.string(),
        source: z.string().describe('mermaid source, e.g. "graph LR; A[Client] --> B[API]"'),
        title: z.string().optional().describe('A heading above it'),
        style: SceneStyleSchema.partial().optional().describe(STYLE_HELP)
      }
    },
    async ({ projectId, source, title, style }) => {
      const drawn = await draw(projectId, source, { style }, baseDir)
      if (!drawn.ok) return text(drawn.reason)

      const item = withHistory(
        projectId,
        () =>
          addScene(
            projectId,
            'diagram',
            {
              source,
              title,
              style: style ?? {},
              src: writeDiagramSvg(projectId, drawn.svg, baseDir),
              ...(drawn.themeStamp ? { themeStamp: drawn.themeStamp } : {})
            },
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
        title: z.string().optional(),
        style: SceneStyleSchema.partial().optional().describe(STYLE_HELP)
      }
    },
    async ({ projectId, timelineItemId, source, title, style }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)
      if (item.kind !== 'diagram') {
        return text(`That clip is a ${item.kind}, not a diagram.`)
      }

      const current = item.data as { title?: string; style?: object }
      // A diagram's colours are in its picture, so a new look is a new drawing.
      const nextStyle = { ...current.style, ...style }
      const drawn = await draw(projectId, source, { ...current, style: nextStyle }, baseDir)
      if (!drawn.ok) return text(drawn.reason)

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
              style: nextStyle,
              src: writeDiagramSvg(projectId, drawn.svg, baseDir),
              ...(drawn.themeStamp ? { themeStamp: drawn.themeStamp } : {})
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
        style: SceneStyleSchema.partial().optional().describe(STYLE_HELP),
        layout: LayoutInput.optional()
      }
    },
    async ({ projectId, timelineItemId, title, bullets, style, layout }) => {
      const item = readTimeline(projectId, baseDir).find((candidate) => candidate.id === timelineItemId)
      if (!item) return text(`No clip found with id ${timelineItemId}.`)
      if (item.kind !== 'scene') {
        return text(
          `That clip is a ${item.kind}, and only a slide has words that can be rewritten. ` +
            'Use talkie_set_narration to change what is said over a recording.'
        )
      }

      // Merged rather than replaced: leaving the bullets out should keep them, not silently
      // empty the slide — and leaving the layout out should not turn an opening card into a slide.
      const current = item.data as Record<string, unknown> & { bullets?: string[]; style?: object }
      withHistory(
        projectId,
        () =>
          updateSceneData(
            projectId,
            timelineItemId,
            {
              ...current,
              title,
              bullets: bullets ?? current.bullets ?? [],
              style: { ...current.style, ...style },
              ...(layout ? { layout } : {})
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

      // Carries on past a clip that fails, as the app's "Speak N clips" does: stopping at the first
      // left every later clip unvoiced, and the agent told only about the one.
      const spoken: string[] = []
      const failed: string[] = []
      for (const segment of wanted) {
        try {
          await narrateSegment(projectId, segment.id, baseDir)
          spoken.push(segment.id)
        } catch (error) {
          failed.push(`${segment.timelineItemId ?? segment.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      if (failed.length === 0) return text(`Voiced ${spoken.length} clip(s).`)
      const report = `Voiced ${spoken.length} clip(s); ${failed.length} failed:\n${failed.join('\n')}`
      if (spoken.length === 0) throw new Error(report)
      return text(report)
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
      const cut = activeVersion(readVersions(projectId, baseDir))
      return text(`Exported the version "${cut.name}" to ${path}`)
    }
  )

  return server
}
