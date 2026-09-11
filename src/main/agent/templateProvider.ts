import type { NarrationProvider, NarrationRequest } from './narrationProvider'
import type { CleanAction } from './cleanActionLog'

/**
 * Narration built from the action log alone, with no model anywhere.
 *
 * This is the default because it always works: no install, no key, no network, no cost, and
 * nothing leaves the machine. It is deliberately plain and says only what the log actually
 * records — a starting draft to edit, not a finished script.
 */
export const templateProvider: NarrationProvider = {
  id: 'template',
  label: 'Built-in (no model)',
  sendsDataOffMachine: false,

  async isAvailable() {
    return { available: true }
  },

  async draft(request: NarrationRequest): Promise<string> {
    const { evidence, clipIndex, clipCount } = request

    if (evidence.kind === 'image') {
      return `Slide ${clipIndex} of ${clipCount}.`
    }

    const sentences = describeActions(evidence.actions)
    if (sentences.length === 0) {
      return `A ${Math.round(evidence.durationSeconds)}-second walkthrough.`
    }

    return sentences.join(' ')
  }
}

function describeActions(actions: CleanAction[]): string[] {
  const sentences: string[] = []
  let openedSomething = false

  for (const action of actions) {
    switch (action.type) {
      case 'navigation': {
        const target = action.label.replace(/ — searched for /, ', searching for ')
        sentences.push(openedSomething ? `Then to ${target}.` : `We start on ${target}.`)
        openedSomething = true
        break
      }
      case 'click': {
        const what = action.label.replace(/^clicked /, '')
        sentences.push(`Select ${what}.`)
        break
      }
      case 'input': {
        const where = action.label.replace(/^typed .*into /, '').replace(/^typed into /, '')
        sentences.push(`Fill in ${where}.`)
        break
      }
      // Annotations are the user's notes to themselves, not something to read aloud.
      default:
        break
    }
  }

  return sentences
}
