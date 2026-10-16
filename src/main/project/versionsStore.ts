import { homedir } from 'os'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { findProjectDir } from './paths'
import { writeJsonAtomic } from './atomicWrite'
import { NO_VERSIONS, VersionsSchema, activeVersion, uniqueVersionName, type Versions } from './versions'

/**
 * A project's versions, kept in `versions.json` beside its timeline. See versions.ts for what a
 * version is. No file means the project has only ever been the full video, and nothing is written
 * until someone leaves a scene out or makes a version — so every project made before this reads
 * exactly as it did.
 */

function projectDir(id: string, baseDir: string): string {
  const dir = findProjectDir(id, baseDir)
  if (!dir) throw new Error(`No project found with id ${id}`)
  return dir
}

export function readVersions(id: string, baseDir: string = homedir()): Versions {
  const path = join(projectDir(id, baseDir), 'versions.json')
  if (!existsSync(path)) return NO_VERSIONS
  const parsed = VersionsSchema.safeParse(JSON.parse(readFileSync(path, 'utf-8')))
  // A file edited into nonsense is not a reason a project cannot open; it plays whole.
  return parsed.success ? parsed.data : NO_VERSIONS
}

function writeVersions(id: string, versions: Versions, baseDir: string): Versions {
  const checked = VersionsSchema.parse(versions)
  writeJsonAtomic(join(projectDir(id, baseDir), 'versions.json'), checked)
  return checked
}

/** The scenes the version being worked on leaves out. */
export function leftOutNow(id: string, baseDir: string = homedir()): string[] {
  return activeVersion(readVersions(id, baseDir)).leftOut
}

/** Put a clip in the version being worked on, or take it out of it. */
export function setClipIncluded(id: string, clipId: string, included: boolean, baseDir: string = homedir()): Versions {
  const versions = readVersions(id, baseDir)
  const current = activeVersion(versions)
  const leftOut = included ? current.leftOut.filter((each) => each !== clipId) : [...new Set([...current.leftOut, clipId])]
  return writeVersions(
    id,
    { ...versions, versions: versions.versions.map((version) => (version.id === current.id ? { ...version, leftOut } : version)) },
    baseDir
  )
}

/** A new version starting as a copy of the one being worked on, and worked on from now. */
export function createVersion(id: string, name: string, baseDir: string = homedir()): Versions {
  const versions = readVersions(id, baseDir)
  const created = { id: randomUUID(), name: uniqueVersionName(name, versions), leftOut: [...activeVersion(versions).leftOut] }
  return writeVersions(id, { active: created.id, versions: [...versions.versions, created] }, baseDir)
}

export function chooseVersion(id: string, versionId: string, baseDir: string = homedir()): Versions {
  const versions = readVersions(id, baseDir)
  if (!versions.versions.some((version) => version.id === versionId)) throw new Error('There is no such version of this project.')
  return writeVersions(id, { ...versions, active: versionId }, baseDir)
}

export function renameVersion(id: string, versionId: string, name: string, baseDir: string = homedir()): Versions {
  const versions = readVersions(id, baseDir)
  if (!versions.versions.some((version) => version.id === versionId)) throw new Error('There is no such version of this project.')
  return writeVersions(
    id,
    {
      ...versions,
      versions: versions.versions.map((version) =>
        version.id === versionId ? { ...version, name: uniqueVersionName(name, versions, versionId) } : version
      )
    },
    baseDir
  )
}

/** Removes a version. The last one cannot go: a project is always some cut of itself. */
export function deleteVersion(id: string, versionId: string, baseDir: string = homedir()): Versions {
  const versions = readVersions(id, baseDir)
  const remaining = versions.versions.filter((version) => version.id !== versionId)
  if (remaining.length === versions.versions.length) throw new Error('There is no such version of this project.')
  if (remaining.length === 0) throw new Error('A project always has at least one version.')
  return writeVersions(id, { active: versions.active === versionId ? remaining[0].id : versions.active, versions: remaining }, baseDir)
}
