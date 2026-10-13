import { describe, expect, it } from 'vitest'
import { buildHome, buildStory, kokoroAvailable, packageStory, type Story } from './kit'
import { meetTalkie } from './stories/meetTalkie'
import { productLaunch } from './stories/productLaunch'
import { appWalkthrough } from './stories/appWalkthrough'
import { architecture } from './stories/architecture'

/**
 * `npm run examples` — builds every example story into `examples/projects/`, voiced.
 *
 * A test run rather than a script because it is the same machinery the suite already drives:
 * the sources run directly, Kokoro is forked from its TypeScript, and mermaid and HTML scenes are
 * drawn in the headless browser the tests use. `STORY=meet-talkie npm run examples` builds one.
 */
const STORIES: Story[] = [meetTalkie, productLaunch, appWalkthrough, architecture]

const wanted = process.env.STORY?.split(',')
const toBuild = STORIES.filter((story) => !wanted || wanted.includes(story.id))

describe.skipIf(!kokoroAvailable() || Boolean(process.env.TOUR))('the example projects', () => {
  for (const story of toBuild) {
    it(`builds ${story.name}, voiced`, async () => {
      const { home, dispose } = buildHome()
      try {
        const built = await buildStory(story, home)
        const out = packageStory(story, built)
        const seconds = built.takes.reduce((total, take) => total + take.seconds, 0)
        console.log(`${story.name}: ${built.takes.length} takes, ${seconds.toFixed(1)}s of narration → ${out}`)
        for (const take of built.takes.filter((take) => take.holdsFor)) {
          console.log(`  holds ${take.holdsFor!.toFixed(1)}s: ${take.text}`)
        }
        expect(built.takes.length).toBeGreaterThan(0)
      } finally {
        dispose()
      }
    })
  }
})
