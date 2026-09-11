import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readSettings, updateSettings, settingsPath } from './settingsStore'
import { SettingsSchema } from './schema'

/**
 * Settings grew a field at a time across several features, and each addition is a chance to
 * write one that cannot be read back — a default that fails its own schema, or a nested object
 * whose siblings are dropped on merge. Rather than testing each field as it is added, this
 * walks whatever the schema currently holds.
 */
function leafPaths(value: unknown, prefix: string[] = []): string[][] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, [...prefix, key])
  )
}

function at(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], value)
}

function nest(path: string[], value: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value) as Record<string, unknown>
}

describe('settings survive a round trip', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-roundtrip-'))
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  const defaults = SettingsSchema.parse({})
  const paths = leafPaths(defaults)

  it('has a schema whose own defaults are valid', () => {
    expect(() => SettingsSchema.parse(defaults)).not.toThrow()
    expect(paths.length).toBeGreaterThan(5)
  })

  it('reads back every default it writes', () => {
    updateSettings(defaults, baseDir)

    for (const path of paths) {
      expect(at(readSettings(baseDir), path), path.join('.')).toEqual(at(defaults, path))
    }
  })

  it('keeps every sibling when one field is changed', () => {
    for (const path of paths) {
      rmSync(baseDir, { recursive: true, force: true })
      mkdirSync(baseDir, { recursive: true })

      const current = at(defaults, path)
      const changed =
        typeof current === 'boolean' ? !current : typeof current === 'number' ? current + 1 : `${current}-changed`

      // A string field constrained to an enum cannot take an arbitrary value; skip those.
      let updated: ReturnType<typeof updateSettings>
      try {
        updated = updateSettings(nest(path, changed) as never, baseDir)
      } catch {
        continue
      }

      expect(at(updated, path), `${path.join('.')} did not take the new value`).toEqual(changed)
      for (const other of paths) {
        if (other.join('.') === path.join('.')) continue
        expect(at(updated, other), `changing ${path.join('.')} disturbed ${other.join('.')}`).toEqual(
          at(defaults, other)
        )
      }
    }
  })

  it('falls back to defaults rather than failing on a file edited into nonsense', () => {
    mkdirSync(join(baseDir, 'Talkie'), { recursive: true })
    writeFileSync(settingsPath(baseDir), '{ "narration": { "pace": "not a number" } }')

    expect(() => readSettings(baseDir)).not.toThrow()
    expect(readSettings(baseDir)).toEqual(defaults)
  })

  it('keeps the numbers that shape speech within ranges that can be spoken', () => {
    const { speech } = defaults
    expect(speech.pace).toBeGreaterThanOrEqual(90)
    expect(speech.pace).toBeLessThanOrEqual(300)
    // Below roughly a quarter second there is no pause at a full stop worth the name.
    expect(speech.sentencePauseMs).toBeGreaterThan(250)
    // `say` makes its own comma pause of about 200ms, which an explicit one replaces.
    expect(speech.clausePauseMs).toBeGreaterThan(200)
  })
})
