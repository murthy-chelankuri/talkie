import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname, join } from 'path'
import { ROOT_NAME } from '../project/migrateStorageRoot'
import { writeJsonAtomic } from '../project/atomicWrite'
import { SettingsSchema, type Settings } from './schema'

/**
 * Settings belong to the person, not to any one demo, so they sit beside the projects folder
 * rather than inside a project.
 */
export function settingsPath(baseDir: string = homedir()): string {
  return join(baseDir, ROOT_NAME, 'settings.json')
}

/**
 * Read the settings, falling back to defaults for anything missing, unreadable or no longer
 * valid. A settings file that has been hand-edited into nonsense must never stop the app
 * opening, and a provider that no longer exists must never be handed to the agent.
 */
export function readSettings(baseDir: string = homedir()): Settings {
  const path = settingsPath(baseDir)
  if (!existsSync(path)) return SettingsSchema.parse({})

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch (err) {
    console.error(`Could not read ${path}, using default settings:`, err)
    return SettingsSchema.parse({})
  }

  const parsed = SettingsSchema.safeParse(raw)
  if (parsed.success) return parsed.data

  console.error(`Ignoring invalid values in ${path}:`, parsed.error.message)
  return SettingsSchema.parse({})
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

export function updateSettings(patch: DeepPartial<Settings>, baseDir: string = homedir()): Settings {
  const next = SettingsSchema.parse(merge(readSettings(baseDir), patch))

  const path = settingsPath(baseDir)
  mkdirSync(dirname(path), { recursive: true })
  writeJsonAtomic(path, next)

  return next
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
