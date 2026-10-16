import { execFileSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { launchTalkie, type Talkie } from './app'
import { makeFixture, PROJECT_NAME, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * Help → Report a Problem, the whole way: the menu opens the checks, the report is made and saved,
 * and an issue is opened with it summarised. The save dialog and the browser are the system's, so
 * both are stood in for; everything between them is the built app's own.
 */
describe('reporting a problem', () => {
  it('saves a report from the Help menu, holding nothing from a project, and opens an issue for it', async () => {
    fixture = makeFixture()
    talkie = await launchTalkie(fixture)
    const { app, win } = talkie
    const zip = join(fixture.home, 'report.zip')
    await app.evaluate(({ dialog, shell }, path) => {
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as typeof dialog.showSaveDialog
      shell.openExternal = async (url: string) => {
        ;(globalThis as { openedIssue?: string }).openedIssue = url
      }
    }, zip)
    await win.getByRole('button', { name: `Open ${PROJECT_NAME}` }).click()
    await win.getByRole('tablist', { name: 'Ways to work on this project' }).waitFor()

    await app.evaluate(({ Menu }) => {
      const help = Menu.getApplicationMenu()!.items.find((item) => item.label === 'Help')!
      help.submenu!.items.find((item) => item.label === 'Report a Problem…')!.click()
    })
    const card = win.getByRole('region', { name: 'Report a problem' })
    await card.getByRole('textbox', { name: 'What went wrong' }).fill('Narration fails over MCP')
    await card.getByRole('button', { name: 'Save report and open GitHub' }).click()
    await card.getByText(/^Saved to /).waitFor({ timeout: 60_000 })
    if (process.env.TALKIE_SHOT) await card.screenshot({ path: process.env.TALKIE_SHOT })

    expect(existsSync(zip)).toBe(true)
    const contents = execFileSync('unzip', ['-p', zip], { encoding: 'utf8' })
    expect(contents).toContain('Narration fails over MCP')
    expect(contents).toContain('Speaking a line')
    expect(contents).toMatch(/\[app\] Talkie started/)
    expect(contents).not.toContain(PROJECT_NAME)
    expect(contents).not.toContain(fixture.home)

    const issue = new URL(await app.evaluate(() => (globalThis as { openedIssue?: string }).openedIssue ?? ''))
    expect(issue.searchParams.get('title')).toBe('Problem: Narration fails over MCP')
    expect(issue.searchParams.get('body')).toContain('## Checks')
    expect(readFileSync(join(fixture.home, 'Talkie', 'logs', 'talkie.log'), 'utf8')).toContain('[app] Talkie started')
  }, 120_000)
})
