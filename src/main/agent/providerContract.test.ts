import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NARRATION_PROVIDERS, describeProviders, narrationProvider } from './providerRegistry'
import { NARRATION_PROVIDER_IDS } from '../settings/schema'
import type { NarrationProviderId } from '../settings/schema'

/**
 * Every provider is reached through the same interface and chosen by a string in settings, so a
 * new one can be wired in wrongly without the type checker noticing — registered under the wrong
 * key, missing a label, or throwing from the availability check the settings screen calls on
 * every provider at once. These are the rules the interface cannot express on its own.
 */
describe('every narration provider', () => {
  let baseDir: string
  const originalHome = process.env.HOME
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'talkie-contract-'))
    process.env.HOME = baseDir
  })

  afterEach(() => {
    process.env.HOME = originalHome
    globalThis.fetch = originalFetch
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('is registered for exactly the ids settings can hold', () => {
    expect(Object.keys(NARRATION_PROVIDERS).sort()).toEqual([...NARRATION_PROVIDER_IDS].sort())
  })

  it('is registered under its own id, so settings and the registry cannot disagree', () => {
    for (const [id, provider] of Object.entries(NARRATION_PROVIDERS)) {
      expect(provider.id).toBe(id)
    }
  })

  it('has something to call it in the settings screen', () => {
    for (const provider of Object.values(NARRATION_PROVIDERS)) {
      expect(provider.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('says whether it sends anything off this machine', () => {
    for (const provider of Object.values(NARRATION_PROVIDERS)) {
      expect(typeof provider.sendsDataOffMachine).toBe('boolean')
    }
  })

  it('keeps the two providers that need no account local', () => {
    expect(NARRATION_PROVIDERS.template.sendsDataOffMachine).toBe(false)
    expect(NARRATION_PROVIDERS.local.sendsDataOffMachine).toBe(false)
  })

  it('answers the availability check without throwing, even with nothing installed', async () => {
    // The settings screen asks all of them at once; one throwing would empty the whole list.
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('nothing listening')) as unknown as typeof fetch

    for (const provider of Object.values(NARRATION_PROVIDERS)) {
      await expect(provider.isAvailable()).resolves.toMatchObject({ available: expect.any(Boolean) })
    }
  }, 30_000)

  it('explains itself whenever it reports as unavailable', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('nothing listening')) as unknown as typeof fetch

    for (const provider of Object.values(NARRATION_PROVIDERS)) {
      const availability = await provider.isAvailable()
      if (!availability.available) {
        expect(availability.reason?.trim(), `${provider.id} gave no reason`).toBeTruthy()
      }
    }
  }, 30_000)

  it('falls back to the one that always works if settings hold something unknown', () => {
    expect(narrationProvider('nonsense' as NarrationProviderId).id).toBe('template')
  })

  it('is described to the settings screen without one failure hiding the rest', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('nothing listening')) as unknown as typeof fetch

    const described = await describeProviders()

    expect(described).toHaveLength(NARRATION_PROVIDER_IDS.length)
    expect(described.some((provider) => provider.available)).toBe(true)
  }, 30_000)
})
