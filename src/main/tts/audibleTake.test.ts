import { describe, expect, it, vi } from 'vitest'
import { audibleTake, isSilent } from './audibleTake'

const silence = { audio: new Float32Array(48000) }
const speech = { audio: Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i / 10) * 0.3) }

describe('never keeping a take of silence', () => {
  it('keeps a take that has a voice in it, first time', async () => {
    const generate = vi.fn().mockResolvedValue(speech)

    await expect(audibleTake('Hello.', 1, generate)).resolves.toBe(speech)
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('asks again a shade faster when the voice comes back silent', async () => {
    // One real sentence in af_alloy at 1.0 came back as 4.8 seconds of zeros; at 1.05 it read fine.
    const generate = vi.fn().mockResolvedValueOnce(silence).mockResolvedValueOnce(speech)

    await expect(audibleTake('This is Eenadu.', 1, generate)).resolves.toBe(speech)
    expect(generate).toHaveBeenLastCalledWith(1.02)
  })

  it('says which words would not read, rather than saving silence', async () => {
    const generate = vi.fn().mockResolvedValue(silence)

    await expect(audibleTake('This is Eenadu.', 1, generate)).rejects.toThrow(/“This is Eenadu\.” as silence/)
  })

  it('counts NaN from the model as silence', () => {
    expect(isSilent(Float32Array.from([0, Number.NaN, 0.5]))).toBe(true)
    expect(isSilent(Float32Array.from([0, 0.2, 0]))).toBe(false)
  })
})
