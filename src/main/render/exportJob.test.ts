import { describe, expect, it, vi } from 'vitest'
import { cancelAllExports, cancelExport, exportsRunning, runExport } from './exportJob'

describe('running an export', () => {
  it('says where the file is and how long it took', async () => {
    let clock = 1000
    const result = await runExport(
      'p1',
      async () => {
        clock += 72_000
        return '/renders/demo.mp4'
      },
      vi.fn(),
      () => clock
    )

    expect(result).toEqual({ status: 'done', path: '/renders/demo.mp4', seconds: 72 })
  })

  it('passes progress on as it is reported', async () => {
    const onProgress = vi.fn()
    await runExport(
      'p2',
      async (_id, options) => {
        options.onProgress?.({ stage: 'rendering', fraction: 0.5, renderedFrames: 1, totalFrames: 2 })
        return '/x.mp4'
      },
      onProgress
    )

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ fraction: 0.5 }))
  })

  it('says why it failed, without the IPC wrapping', async () => {
    const result = await runExport('p3', async () => Promise.reject(new Error('The browser closed.')), vi.fn())

    expect(result).toEqual({ status: 'failed', message: 'The browser closed.' })
  })

  it('tells a cancel apart from a failure', async () => {
    const result = runExport(
      'p4',
      (_id, options) =>
        new Promise((_resolve, reject) => options.cancelSignal?.(() => reject(new Error('renderMedia() got cancelled')))),
      vi.fn()
    )
    expect(cancelExport('p4')).toBe(true)

    expect(await result).toEqual({ status: 'cancelled' })
  })

  it('refuses to export one project twice at once', async () => {
    let finish: (path: string) => void = () => undefined
    const first = runExport('p5', () => new Promise((resolve) => (finish = resolve)), vi.fn())

    expect(await runExport('p5', async () => '/y.mp4', vi.fn())).toEqual({
      status: 'failed',
      message: 'This project is already being exported.'
    })
    finish('/x.mp4')
    expect((await first).status).toBe('done')
  })

  it('has nothing to cancel when nothing is running', () => {
    expect(cancelExport('nobody')).toBe(false)
  })

  it('stops every export before the app quits, and waits for each to finish stopping', async () => {
    const stopped: string[] = []
    const hang = (id: string) =>
      runExport(
        id,
        (_id, options) =>
          new Promise((_resolve, reject) =>
            options.cancelSignal?.(() =>
              setTimeout(() => {
                stopped.push(id)
                reject(new Error('cancelled'))
              }, 20)
            )
          ),
        vi.fn()
      )
    const results = [hang('q1'), hang('q2')]
    expect(exportsRunning()).toBe(true)

    await cancelAllExports()

    expect(stopped.sort()).toEqual(['q1', 'q2'])
    expect((await Promise.all(results)).map((result) => result.status)).toEqual(['cancelled', 'cancelled'])
    expect(exportsRunning()).toBe(false)
  })

  it('does not wait for ever on an export that will not stop', async () => {
    void runExport('stuck', () => new Promise(() => undefined), vi.fn())

    const started = Date.now()
    await cancelAllExports(50)

    expect(Date.now() - started).toBeLessThan(1000)
  })
})
