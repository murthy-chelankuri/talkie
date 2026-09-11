import type { NarrationProvider } from './narrationProvider'
import type { NarrationProviderId } from '../settings/schema'
import { templateProvider } from './templateProvider'
import { claudeCliProvider } from './claudeCliProvider'
import { ollamaProvider } from './ollamaProvider'
import { anthropicProvider } from './anthropicProvider'

export const NARRATION_PROVIDERS: Record<NarrationProviderId, NarrationProvider> = {
  template: templateProvider,
  'claude-cli': claudeCliProvider,
  ollama: ollamaProvider,
  anthropic: anthropicProvider
}

export function narrationProvider(id: NarrationProviderId): NarrationProvider {
  return NARRATION_PROVIDERS[id] ?? templateProvider
}

export interface ProviderDescription {
  id: NarrationProviderId
  label: string
  sendsDataOffMachine: boolean
  available: boolean
  reason?: string
}

/** Every provider with its current availability, for the settings screen. */
export async function describeProviders(): Promise<ProviderDescription[]> {
  return Promise.all(
    Object.values(NARRATION_PROVIDERS).map(async (provider) => {
      const { available, reason } = await provider.isAvailable().catch(() => ({
        available: false,
        reason: 'This provider could not be reached.'
      }))
      return {
        id: provider.id,
        label: provider.label,
        sendsDataOffMachine: provider.sendsDataOffMachine,
        available,
        reason
      }
    })
  )
}
