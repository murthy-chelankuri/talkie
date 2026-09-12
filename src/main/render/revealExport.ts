import { homedir } from 'os'
import { existsSync, statSync } from 'fs'
import { relative, isAbsolute } from 'path'
import { shell } from 'electron'
import { projectsRootDir } from '../project/paths'

/**
 * Open a finished render, or show it where it lives.
 *
 * Both hand a path to the operating system, so both refuse anything outside the projects
 * folder: the renderer should never be able to ask the shell to open an arbitrary file, even
 * though today it only ever asks for its own exports.
 */
function isInsideProjects(path: string, baseDir: string): boolean {
  const root = projectsRootDir(baseDir)
  const within = relative(root, path)
  return within.length > 0 && !within.startsWith('..') && !isAbsolute(within)
}

export interface ExportedFile {
  path: string
  name: string
  bytes: number
}

export function describeExport(path: string, baseDir: string = homedir()): ExportedFile | null {
  if (!isInsideProjects(path, baseDir) || !existsSync(path)) return null

  return { path, name: path.split('/').pop() ?? path, bytes: statSync(path).size }
}

export async function openExport(path: string, baseDir: string = homedir()): Promise<string | null> {
  if (!isInsideProjects(path, baseDir)) return 'That file is not part of a Talkie project.'
  if (!existsSync(path)) return 'That file is no longer there.'

  // Resolves to an error string rather than throwing, so a missing video player is a message.
  return (await shell.openPath(path)) || null
}

export function showExportInFinder(path: string, baseDir: string = homedir()): string | null {
  if (!isInsideProjects(path, baseDir)) return 'That file is not part of a Talkie project.'
  if (!existsSync(path)) return 'That file is no longer there.'

  shell.showItemInFolder(path)
  return null
}
