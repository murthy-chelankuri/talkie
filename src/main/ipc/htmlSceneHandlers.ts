import { dialog, type BrowserWindow, type IpcMain } from 'electron'
import { basename, extname } from 'path'
import { openProject } from '../project/projectApi'
import {
  addHtmlScene,
  checkSceneItem,
  editHtmlScene,
  readHtmlScene,
  type HtmlSceneInput,
  type HtmlSceneOutcome
} from '../htmlScene/htmlSceneApi'
import { listTemplates, templateFiles, templateThumbnail } from '../htmlScene/templates'
import { writeHtmlScene } from '../htmlScene/writeHtmlScene'
import type { TimelineItem } from '../project/timeline/schema'

/** What the window is told after a change: the clip, what the check found, and any import warnings. */
export interface HtmlSceneResult {
  item: TimelineItem
  problems: string[]
  warnings: string[]
}

export type HtmlSceneWriteResult = ({ status: 'written' } & HtmlSceneResult) | { status: 'failed'; reason: string }

const summarise = (outcome: HtmlSceneOutcome): HtmlSceneResult => ({
  item: outcome.item,
  problems: outcome.check.problems,
  warnings: outcome.warnings
})

const textFiles = (files: { path: string; text?: string }[]): Record<string, string> =>
  Object.fromEntries(files.flatMap((file) => (file.text === undefined ? [] : [[file.path, file.text]])))

/**
 * Write with the model, and when the check finds problems, once more with them in hand — as theme
 * proposals already do. A second set of problems is shown rather than tried again forever.
 */
async function writeChecked(
  projectId: string,
  instruction: string,
  apply: (written: { title: string; files: Record<string, string> }) => Promise<HtmlSceneOutcome>,
  current?: { itemId: string; files: Record<string, string>; title: string }
): Promise<HtmlSceneWriteResult> {
  const project = openProject(projectId)
  const ask = (problems?: string[], files?: Record<string, string>) =>
    writeHtmlScene({ instruction, current: files, title: current?.title, projectName: project.name, context: project.context, problems })

  const first = await ask(undefined, current?.files)
  if (first.status === 'failed') return first
  let outcome = await apply(first)
  if (outcome.check.problems.length > 0) {
    const files = textFiles(readHtmlScene(projectId, outcome.item.id).files)
    const second = await ask(outcome.check.problems, files)
    if (second.status === 'written') outcome = await editHtmlScene(projectId, outcome.item.id, { files: second.files })
  }
  return { status: 'written', ...summarise(outcome) }
}

export function registerHtmlSceneHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('project:htmlScene:add', async (_event, id: string, input: HtmlSceneInput & { title: string }) =>
    summarise(await addHtmlScene(id, input))
  )
  ipcMain.handle('project:htmlScene:edit', async (_event, id: string, itemId: string, input: HtmlSceneInput) =>
    summarise(await editHtmlScene(id, itemId, input))
  )
  ipcMain.handle('project:htmlScene:read', (_event, id: string, itemId: string) => {
    const { data, files } = readHtmlScene(id, itemId)
    return { data, files }
  })
  ipcMain.handle('project:htmlScene:check', async (_event, id: string, itemId: string, atSeconds?: number[]) => {
    const check = await checkSceneItem(id, itemId, atSeconds)
    return {
      problems: check.problems,
      frames: check.frames.map((frame) => ({ atSeconds: frame.atSeconds, url: `data:image/png;base64,${frame.png.toString('base64')}` }))
    }
  })
  ipcMain.handle('project:htmlScene:import', async (_event, id: string): Promise<HtmlSceneResult | null> => {
    const window = getWindow()
    const options = {
      title: 'Import an HTML page or folder',
      properties: ['openFile' as const, 'openDirectory' as const],
      filters: [{ name: 'Web pages', extensions: ['html', 'htm'] }]
    }
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const path = result.filePaths[0]
    return summarise(await addHtmlScene(id, { importPath: path, title: basename(path, extname(path)) }))
  })
  ipcMain.handle('project:htmlScene:templates', () =>
    listTemplates().map((template) => ({ ...template, thumbnail: templateThumbnail(template.id) }))
  )
  // With the values the template declares, so the new scene's form has every field from the start.
  ipcMain.handle('project:htmlScene:fromTemplate', async (_event, id: string, templateId: string, title: string) =>
    summarise(
      await addHtmlScene(id, {
        files: templateFiles(templateId) as Record<string, string>,
        title,
        params: listTemplates().find((template) => template.id === templateId)?.values ?? {}
      })
    )
  )
  ipcMain.handle('project:htmlScene:describe', (_event, id: string, instruction: string) =>
    writeChecked(id, instruction, (written) => addHtmlScene(id, { title: written.title, files: written.files, prompt: instruction }))
  )
  ipcMain.handle('project:htmlScene:change', (_event, id: string, itemId: string, instruction: string) => {
    const { data, files } = readHtmlScene(id, itemId)
    return writeChecked(id, instruction, (written) => editHtmlScene(id, itemId, { files: written.files, prompt: instruction }), {
      itemId,
      files: textFiles(files),
      title: data.title
    })
  })
}
