import { join } from 'path'
import type { Page } from 'playwright'
import { Film, type Filmed } from './film'

/**
 * The tour Meet Talkie narrates: one project made from nothing, every capability in the order
 * someone meets it. Each `film.shot` is one scene of the finished video; everything between
 * shots — a recording being walked, a draft being written, a voice being read — is waited for
 * and cut out.
 *
 * `TOUR_UNTIL=<shot>` stops after that shot, for working on the tour a step at a time.
 */
export const TOUR_PROJECT = 'Taskboard launch'

const ABOUT =
  "Taskboard shows a small team what's waiting, what's in progress and what's finished this week. " +
  'This video introduces it to teams trying it for the first time.'

export async function filmTour(home: string, env: Record<string, string>, appUrl: string, outDir: string): Promise<Filmed> {
  const film = await Film.start(home, join(outDir, 'video'), env)
  const until = process.env.TOUR_UNTIL
  const win = film.win
  const done = async (name: string): Promise<boolean> => {
    if (until !== name) return false
    await win.screenshot({ path: join(outDir, `until-${name}.png`) })
    return true
  }

  try {
    await win.getByRole('button', { name: 'New project' }).waitFor()
    await film.pause(800)

    await film.shot('new-project', async () => {
      await film.click(win.getByRole('button', { name: 'New project' }))
      await film.type(win.getByRole('textbox', { name: 'Project name' }), TOUR_PROJECT)
      await film.type(win.getByRole('textbox', { name: 'What this project is about' }), ABOUT, { delayMs: 12 })
      await film.click(win.getByRole('button', { name: 'Create project' }), { settleMs: 1500 })
    })
    if (await done('new-project')) return await film.finish()

    // The toolbar is a window of its own, filmed on its own.
    await film.shot('record', async () => {
      await film.openPanel('Add')
      const opened = film.app.waitForEvent('window')
      await film.click(win.getByRole('button', { name: /Record a session/ }), { settleMs: 300 })
      await film.adoptToolbar(await opened)
    })
    const toolbar = await toolbarPage(film)
    await film.shot(
      'toolbar',
      async () => {
        await film.type(toolbar.getByRole('textbox'), appUrl, { delayMs: 30 })
        await film.click(toolbar.getByRole('checkbox', { name: /Show me round it/ }))
        // Ends on the press: the toolbar grows into its recording controls straight after, and
        // the shot is framed to the window as it was when it began.
        await film.click(toolbar.getByRole('button', { name: 'Start recording' }), { settleMs: 150 })
      },
      'toolbar'
    )

    // The walk: the model reads each page and picks somewhere safe to go, then the recording
    // finishes on its own and is cut into scenes. Minutes, not worth watching here — the scenes
    // it leaves are the footage of it.
    await waitForClips(win, 1, 10 * 60_000)
    await film.pause(2500)

    await film.shot('recorded', async () => {
      await film.click(win.getByRole('button', { name: 'Play', exact: true }), { settleMs: 6000 })
      await win.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => undefined)
    })
    if (await done('recorded')) return await film.finish()

    // ------------------------------------------------------------- the words
    await film.shot('write', async () => {
      await film.click(win.getByRole('button', { name: 'Write the words' }), { settleMs: 3500 })
    })
    await win.getByRole('button', { name: /^Speak \d+ clips?$/ }).waitFor({ timeout: 5 * 60_000 })
    await film.pause(1000)
    await film.shot('written', async () => {
      // A beat on the timeline first, where the words have arrived under every clip.
      await film.pause(2500)
      await film.click(win.getByRole('tab', { name: 'Script' }), { settleMs: 2500 })
      await win.mouse.wheel(0, 400)
      await film.pause(2000)
    })
    if (await done('written')) return await film.finish()

    // ------------------------------------------------------------- the voice
    await film.shot('voice', async () => {
      await film.click(win.getByRole('tab', { name: 'Timeline' }))
      await film.openPanel('Voice')
      await film.pointAt(win.getByRole('combobox', { name: 'Voice for this project' }))
      await film.pause(1200)
      await film.click(win.getByRole('button', { name: /^Speak \d+ clips?$/ }), { settleMs: 2500 })
    })
    await win.getByRole('button', { name: 'All voiced' }).waitFor({ timeout: 10 * 60_000 })
    await film.shot('voiced', async () => {
      await film.pause(1500)
      await film.click(win.getByRole('button', { name: 'Play', exact: true }), { settleMs: 5000 })
      await win.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => undefined)
    })
    if (await done('voiced')) return await film.finish()

    // ------------------------------------------------------------ the scenes
    // Every scene added is an HTML scene: a gallery of templates, then a form of the values each
    // one declares. The dialog is named for adding until a template is chosen, then for editing.
    const dialog = win.getByRole('dialog')
    const saved = async (): Promise<void> => {
      await win.getByText('Saving and checking…').waitFor({ state: 'hidden', timeout: 3 * 60_000 })
    }
    await film.shot('slide', async () => {
      await film.openPanel('Add')
      await film.click(win.getByRole('button', { name: /Add a scene/ }), { settleMs: 1500 })
      await film.pointAt(dialog.getByRole('button', { name: 'Start from Steps' }))
      await film.pause(1000)
      await film.click(dialog.getByRole('button', { name: 'Start from Slide' }), { settleMs: 2500 })
      await film.replace(dialog.getByRole('textbox', { name: 'Title', exact: true }), 'Why teams switch')
      await film.replace(dialog.getByRole('textbox', { name: 'Point 1' }), 'See the whole week at a glance', { delayMs: 20 })
    })
    await film.shot('slide-written', async () => {
      await film.pause(1500)
      await film.click(dialog.getByRole('button', { name: 'Save scene' }), { settleMs: 500 })
      await saved()
      await film.pause(1500)
      await film.click(dialog.getByRole('button', { name: 'Close', exact: true }).first(), { settleMs: 1500 })
    })

    await film.shot('diagram', async () => {
      await film.click(win.getByRole('button', { name: /Add a scene/ }), { settleMs: 1500 })
      await film.click(dialog.getByRole('button', { name: 'Start from Steps' }), { settleMs: 2500 })
      await film.replace(dialog.getByRole('textbox', { name: 'Title', exact: true }), 'How a task moves')
      await film.pause(2000)
      await film.click(dialog.getByRole('button', { name: 'Save scene' }), { settleMs: 500 })
      await saved()
      await film.click(dialog.getByRole('button', { name: 'Close', exact: true }).first(), { settleMs: 1500 })
    })

    await film.shot('html', async () => {
      await film.click(win.getByRole('button', { name: /Add a scene/ }), { settleMs: 1500 })
      await film.pointAt(dialog.getByRole('textbox', { name: 'Describe the scene' }))
      await film.pause(800)
      // A template lands on the timeline as soon as it is chosen; the AI then makes it this project's.
      await film.click(dialog.getByRole('button', { name: 'Start from Big number' }), { settleMs: 2500 })
      await film.click(dialog.getByRole('tab', { name: 'Ask AI' }), { settleMs: 800 })
      await film.type(
        dialog.getByRole('textbox', { name: 'Change the scene' }),
        'Count up to 6.5, with the line "hours saved every week"',
        { delayMs: 25 }
      )
      await film.click(dialog.getByRole('button', { name: 'Change it' }), { settleMs: 2000 })
    })
    await dialog.getByRole('button', { name: 'Change it' }).waitFor({ timeout: 5 * 60_000 })
    await film.shot('html-changed', async () => {
      await film.pause(1500)
      await film.click(dialog.getByRole('tab', { name: 'Content' }), { settleMs: 2500 })
      await film.click(dialog.getByRole('button', { name: 'Close', exact: true }).first(), { settleMs: 1500 })
    })
    if (await done('html')) return await film.finish()

    // ------------------------------------------------------------- settings
    const settings = win.getByRole('dialog', { name: 'Settings' })
    const section = (name: string): Promise<void> => film.click(settings.getByRole('button', { name: new RegExp(`^${name} `) }), { settleMs: 1800 })
    await film.shot('settings', async () => {
      await film.click(win.getByRole('button', { name: 'Settings' }), { settleMs: 1500 })
      await film.pointAt(settings.getByRole('radio', { name: /^Claude CLI/ }))
      await film.pause(1200)
      await film.pointAt(settings.getByRole('radio', { name: /^Kokoro/ }))
      await film.pause(1200)
      await section('Recording')
      await section('Export')
      await section('System')
      await film.click(settings.getByRole('switch', { name: 'Let AI agents connect' }), { settleMs: 1500 })
      await section('Themes')
    })

    await film.shot('theme', async () => {
      await film.click(settings.getByRole('button', { name: 'Create with AI' }))
      await film.type(settings.getByRole('textbox', { name: 'Theme name' }), 'Taskboard')
      await film.type(settings.getByRole('textbox', { name: 'Website' }), appUrl, { delayMs: 25 })
      await film.click(settings.getByRole('button', { name: 'Create theme' }), { settleMs: 2500 })
    })
    const save = settings.getByRole('button', { name: /^Save/ })
    await save.waitFor({ timeout: 5 * 60_000 })
    await film.shot('theme-made', async () => {
      await film.pause(3000)
      await film.click(save, { settleMs: 2000 })
      await film.click(settings.getByRole('button', { name: 'Done' }), { settleMs: 1000 })
    })
    if (await done('theme-made')) return await film.finish()

    await film.shot('theme-applied', async () => {
      await film.openPanel('Project')
      await film.click(win.getByRole('button', { name: /^About this project/ }))
      const about = win.getByRole('dialog', { name: 'About this project' })
      const theme = about.getByRole('combobox', { name: 'Theme' })
      await film.pointAt(theme)
      await theme.selectOption({ label: 'Taskboard' })
      await film.pause(2500)
      await film.click(about.getByRole('button', { name: 'Close' }), { settleMs: 1500 })
      await film.click(win.getByRole('button', { name: 'Play', exact: true }), { settleMs: 4000 })
      await win.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => undefined)
    })
    if (await done('theme-applied')) return await film.finish()

    // ---------------------------------------------------------------- agent
    await film.shot('agent', async () => {
      await film.openPanel('Agent')
      await film.type(
        win.getByRole('textbox', { name: 'Ask Talkie to change this project' }),
        // Something the project already holds the answer to: asked for a closing slide saying
        // where to try Taskboard, it rightly would not make up an address.
        'Add a short introduction after the opening card that says what Taskboard is for, with words to go with it.',
        { delayMs: 25 }
      )
      await film.click(win.getByRole('button', { name: 'Send' }), { settleMs: 2500 })
    })
    // The box is closed to typing while the agent works, and opens again when it is done.
    await win.waitForFunction(
      () => !(document.querySelector('[aria-label="Ask Talkie to change this project"]') as HTMLTextAreaElement | null)?.disabled,
      undefined,
      { timeout: 10 * 60_000 }
    )
    await film.shot('agent-done', async () => {
      await film.pause(4000)
    })
    if (await done('agent-done')) return await film.finish()

    // --------------------------------------------------------------- export
    await film.shot('export', async () => {
      await film.click(win.getByRole('button', { name: 'Export video' }), { settleMs: 5000 })
    })
    await win.getByText(/^(Video exported|Export failed)$/).waitFor({ timeout: 15 * 60_000 })
    if (await win.getByText('Export failed').isVisible()) throw new Error('The tour project failed to export')
    await film.shot('exported', async () => {
      await film.pause(4000)
    })

    return await film.finish()
  } catch (err) {
    await win.screenshot({ path: join(outDir, 'failed.png') }).catch(() => undefined)
    await film.finish().catch(() => undefined)
    throw err
  }
}

async function toolbarPage(film: Film): Promise<Page> {
  const pages = film.app.windows()
  const toolbar = pages.find((page) => page !== film.win)
  if (!toolbar) throw new Error('The recording toolbar did not open')
  return toolbar
}

/** Wait until the timeline holds at least this many clips, as the inspector counts them. */
async function waitForClips(win: Page, count: number, timeout: number): Promise<void> {
  await win.waitForFunction(
    (wanted) => Number(/of (\d+) voiced/.exec(document.body.innerText)?.[1] ?? 0) >= wanted,
    count,
    { timeout }
  )
}
