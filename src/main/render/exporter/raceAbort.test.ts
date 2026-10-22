import { describe, expect, it } from 'vitest'
import { getEventListeners } from 'events'
import { raceAbort } from './raceAbort'

describe('waiting on work that a crash can cut short', () => {
  it('gives the work’s result when it settles first', async () => {
    await expect(raceAbort(Promise.resolve('frame'), new AbortController().signal)).resolves.toBe('frame')
    await expect(raceAbort(Promise.reject(new Error('seek failed')), new AbortController().signal)).rejects.toThrow('seek failed')
  })

  it('gives the crash when it comes first', async () => {
    const crash = new AbortController()
    const waiting = raceAbort(new Promise(() => undefined), crash.signal)
    crash.abort(new Error('The export tab crashed'))
    await expect(waiting).rejects.toThrow('The export tab crashed')
    await expect(raceAbort(Promise.resolve(1), crash.signal)).rejects.toThrow('The export tab crashed')
  })

  it('leaves nothing waiting on the crash once each piece of work has settled', async () => {
    // Every frame of an export waits like this; anything left behind is kept for the whole export.
    const crash = new AbortController()
    for (let frame = 0; frame < 1000; frame++) await raceAbort(Promise.resolve(frame), crash.signal)
    await raceAbort(Promise.reject(new Error('one failure')), crash.signal).catch(() => undefined)
    expect(getEventListeners(crash.signal, 'abort')).toHaveLength(0)
  })
})
