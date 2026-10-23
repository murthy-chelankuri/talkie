import type { IpcMain } from 'electron'
import { homedir } from 'os'
import { join, normalize, sep } from 'path'
import {
  addFontInto,
  describeFontFiles,
  deleteTheme,
  duplicateTheme,
  findThemeDir,
  listThemes,
  projectsUsingTheme,
  themesRootDir,
  updateTheme,
  writeAssetInto
} from '../themes/themeApi'
import { ThemeDraftSchema } from '../themes/schema'
import { renderThemeFrom } from '../themes/toRenderTheme'
import { checkCompliance } from '../themes/compliance'
import { generateStatus, generateTheme, saveGeneratedTheme } from '../themes/generate/generateTheme'

/**
 * Where a theme being edited keeps its files: a saved theme's own folder, or — for one made by AI
 * and not yet saved — its draft folder. A draft folder named by the window is only trusted inside
 * the drafts directory, since it is about to be written to.
 */
export type ThemeTarget = { themeId: string } | { stagingDir: string } | null

function dirFor(target: ThemeTarget): string | undefined {
  if (!target) return undefined
  if ('themeId' in target) return findThemeDir(target.themeId)
  const drafts = join(themesRootDir(homedir()), '.drafts')
  const dir = normalize(target.stagingDir)
  return dir.startsWith(drafts + sep) ? dir : undefined
}

export function registerThemeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:themes:list', () => listThemes())
  ipcMain.handle('settings:themes:create', (_event, draft: unknown, stagingDir?: string) =>
    saveGeneratedTheme(ThemeDraftSchema.parse(draft), stagingDir ? dirFor({ stagingDir }) : undefined)
  )
  ipcMain.handle('settings:themes:update', (_event, id: string, draft: unknown) => updateTheme(id, ThemeDraftSchema.parse(draft)))
  ipcMain.handle('settings:themes:delete', (_event, id: string) => deleteTheme(id))
  ipcMain.handle('settings:themes:duplicate', (_event, id: string) => duplicateTheme(id))
  ipcMain.handle('settings:themes:usage', (_event, id: string) => projectsUsingTheme(id))
  ipcMain.handle(
    'settings:themes:generate',
    (_event, request: { name: string; url?: string; description?: string; folder?: string; file?: { bytes: Uint8Array; fileName: string } }) =>
      generateTheme({
        ...request,
        file: request.file ? { bytes: Buffer.from(request.file.bytes), fileName: request.file.fileName } : undefined
      })
  )
  ipcMain.handle('settings:themes:generateStatus', () => generateStatus())
  // The brand check: the draft's own warnings, the same ones agents see, for the editor's panel.
  ipcMain.handle('settings:themes:compliance', (_event, draft: unknown) => checkCompliance(ThemeDraftSchema.parse(draft)))
  ipcMain.handle(
    'settings:themes:addAsset',
    (_event, target: ThemeTarget, kind: 'logo' | 'background' | 'font', slot: string, fileName: string, bytes: Uint8Array) => {
      const dir = dirFor(target)
      if (!dir) throw new Error('There is nowhere to keep that file yet. Save the theme first.')
      return writeAssetInto(dir, kind, slot, fileName, Buffer.from(bytes))
    }
  )
  // The person's own fonts: read as they arrive, so the family names itself and a file that is not
  // a font is turned away there and then.
  ipcMain.handle('settings:themes:addFont', (_event, target: ThemeTarget, fileName: string, bytes: Uint8Array) => {
    const dir = dirFor(target)
    if (!dir) throw new Error('There is nowhere to keep that file yet. Save the theme first.')
    return addFontInto(dir, fileName, Buffer.from(bytes))
  })
  ipcMain.handle('settings:themes:fontFiles', (_event, target: ThemeTarget, files: string[]) => {
    const dir = dirFor(target)
    return dir ? describeFontFiles(dir, files) : []
  })
  // The editor's preview: the draft as it stands, drawn exactly as a video would draw it.
  ipcMain.handle('settings:themes:render', (_event, draft: unknown, target: ThemeTarget) =>
    renderThemeFrom(ThemeDraftSchema.parse(draft), dirFor(target))
  )
}
