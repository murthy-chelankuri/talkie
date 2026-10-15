import { describe, expect, it } from 'vitest'
import { describeNarrationFailures, narrateEach } from './narrateEach'

describe('speaking every clip', () => {
  it('carries on past a clip that fails, so the scenes after it still get a voice', async () => {
    const spoken: string[] = []
    const failures = await narrateEach(['one', 'two', 'three', 'four'], async (clip) => {
      if (clip === 'two') throw new Error('The Kokoro voice read “two” as silence.')
      spoken.push(clip)
    })

    expect(spoken).toEqual(['one', 'three', 'four'])
    expect(failures).toEqual(['The Kokoro voice read “two” as silence.'])
  })

  it('says what failed, once for one clip and with a count for several', () => {
    expect(describeNarrationFailures([])).toBeNull()
    expect(describeNarrationFailures(['A.'])).toBe('A.')
    expect(describeNarrationFailures(['A.', 'B.'])).toBe('2 clips could not be spoken. A. B.')
  })
})
