import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { ROOT_NAME } from '../project/migrateStorageRoot'
import { writeJsonAtomic } from '../project/atomicWrite'
import { SettingsSchema, SpeechSettingsSchema, type Settings } from './schema'
import { sharedSettingsPath } from '../studio/studio'

/**
 * Readable and writable by its owner and nobody else: this file carries an API key and the hash
 * of the token that lets an agent drive the app, neither of which other accounts on the machine
 * have any business reading.
 */
const SETTINGS_FILE_MODE = 0o600

/**
 * Settings belong to the person, not to any one project, so they sit beside the projects folder
 * rather than inside a project.
 */
export function settingsPath(baseDir: string = homedir()): string {
  return join(baseDir, ROOT_NAME, 'settings.json')
}

/**
 * The settings that shape a video, kept in the Studio so a project sounds, looks and exports the
 * same on every Mac it is cloned to: the voice and its pace, the click highlight, captions burned
 * in. Everything else — model providers and their keys, the agent token, whether to trust a
 * self-signed certificate — is this Mac's alone, and stays in settings.json, which never enters
 * the Studio. A setting added later is this Mac's until someone adds it here on purpose.
 */
function sharedPart(settings: Settings): Record<string, unknown> {
  return {
    speech: settings.speech,
    recording: { highlight: settings.recording.highlight, highlightColour: settings.recording.highlightColour },
    export: settings.export
  }
}

function localPart(settings: Settings): Record<string, unknown> {
  const { speech: _speech, export: _export, ...rest } = settings
  return { ...rest, recording: { allowUntrustedCertificates: settings.recording.allowUntrustedCertificates } }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return isPlainObject(raw) ? raw : null
  } catch (err) {
    console.error(`Could not read ${path}, using defaults for what it holds:`, err)
    return null
  }
}

/**
 * Read the settings, falling back to defaults for anything missing, unreadable or no longer
 * valid. A settings file that has been hand-edited into nonsense must never stop the app
 * opening, and a provider that no longer exists must never be handed to the agent.
 *
 * The Studio's shared settings are laid over this Mac's. Before there was a Studio they were all
 * in settings.json, which is where they are read from until the first save moves them.
 */
export function readSettings(baseDir: string = homedir()): Settings {
  const local = readJsonObject(settingsPath(baseDir)) ?? {}
  const shared = readJsonObject(sharedSettingsPath(baseDir)) ?? {}

  const parsed = SettingsSchema.safeParse(merge(local, shared))
  if (parsed.success) return parsed.data

  console.error('Ignoring invalid settings:', parsed.error.message)
  const localOnly = SettingsSchema.safeParse(local)
  return localOnly.success ? localOnly.data : SettingsSchema.parse({})
}

function writeSettings(next: Settings, baseDir: string): void {
  const path = settingsPath(baseDir)
  mkdirSync(dirname(path), { recursive: true })
  writeJsonAtomic(path, localPart(next), SETTINGS_FILE_MODE)
  const shared = sharedSettingsPath(baseDir)
  mkdirSync(dirname(shared), { recursive: true })
  writeJsonAtomic(shared, sharedPart(next))
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export function updateSettings(patch: DeepPartial<Settings>, baseDir: string = homedir()): Settings {
  const next = SettingsSchema.parse(merge(readSettings(baseDir), patch))
  writeSettings(next, baseDir)
  return next
}

/**
 * Put the voice back the way it came.
 *
 * The defaults live in the schema, so resetting cannot drift from what a fresh install gets —
 * which is the only thing that makes "reset" mean anything.
 */
export function resetSpeechSettings(baseDir: string = homedir()): Settings {
  const next = SettingsSchema.parse({
    ...readSettings(baseDir),
    speech: SpeechSettingsSchema.parse({})
  })
  writeSettings(next, baseDir)
  return next
}

/** Moves the shared settings out of settings.json into the Studio, once. */
export function moveSharedSettings(baseDir: string = homedir()): void {
  if (existsSync(sharedSettingsPath(baseDir)) || !existsSync(settingsPath(baseDir))) return
  writeSettings(readSettings(baseDir), baseDir)
}

function merge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(patch)) return base
  if (!isPlainObject(base)) return patch as T

  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isPlainObject(value) ? merge(result[key], value) : value
  }
  return result as T
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
