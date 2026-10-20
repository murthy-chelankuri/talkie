import { describe, expect, it } from 'vitest'
import { cleanVoiceFilter, takeLevelsFrom } from './cleanVoice'

function readings(levels: (number | '-inf')[]): string {
  return levels.map((level) => `frame:0 pts:0\nlavfi.astats.Overall.RMS_level=${level}`).join('\n')
}

describe('reading a take for the room and the voice', () => {
  it('takes the room from the quietest windows and the voice from the loudest', () => {
    const levels = takeLevelsFrom(readings([-45, -44, -45, -44, -18, -17, -16, -18, -17, -16, -45, -18]))

    expect(levels?.floorDb).toBeLessThan(-40)
    expect(levels?.voiceDb).toBeGreaterThan(-20)
  })

  it('does not count digital silence as the room', () => {
    const levels = takeLevelsFrom(readings(['-inf', '-inf', '-inf', -50, -50, -50, -20, -20, -20, -20]))

    expect(levels?.floorDb).toBe(-50)
  })

  it('has nothing to say about a take too short to measure', () => {
    expect(takeLevelsFrom(readings([-40, -20]))).toBeNull()
  })
})

describe('the clean-up a take is given', () => {
  it('denoises against the room it measured', () => {
    const filter = cleanVoiceFilter({ floorDb: -44, voiceDb: -17 })

    expect(filter).toContain('afftdn=nr=24:nf=-38.0')
    expect(filter).toContain('agate=')
  })

  it('leaves the denoiser out where there is no room to tell from the voice', () => {
    // A take spoken without a pause, or a test tone: denoising it against itself eats the voice.
    const filter = cleanVoiceFilter({ floorDb: -20, voiceDb: -17 })

    expect(filter).not.toContain('afftdn')
    expect(filter).not.toContain('agate')
    expect(filter).toContain('highpass')
  })

  it('still cuts rumble and evens the voice when the take could not be measured', () => {
    const filter = cleanVoiceFilter(null)

    expect(filter).toMatch(/^highpass=f=80,/)
    expect(filter).toContain('acompressor')
    expect(filter).toContain('deesser')
  })

  it('keeps the denoiser inside the floor it accepts, however loud the room', () => {
    expect(cleanVoiceFilter({ floorDb: -15, voiceDb: 0 })).toContain('nf=-20.0')
    expect(cleanVoiceFilter({ floorDb: -100, voiceDb: -20 })).toContain('nf=-80.0')
  })
})
