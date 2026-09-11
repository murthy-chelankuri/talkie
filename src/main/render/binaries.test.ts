import { describe, expect, it, afterEach } from 'vitest'
import { binariesDirectory, ffOptions } from './binaries'

/**
 * The packaged app failed its own export check before this existed: ffmpeg is copied out of the
 * asar archive at build time, and nothing tells Remotion where it went.
 */
describe('locating the bundled video tools', () => {
  // resourcesPath is only defined inside Electron, so tests set and clear it by hand.
  const asMutable = process as unknown as { resourcesPath?: string }
  const original = asMutable.resourcesPath

  afterEach(() => {
    asMutable.resourcesPath = original
  })

  it('lets Remotion resolve them itself when running from a checkout', () => {
    asMutable.resourcesPath = undefined

    expect(binariesDirectory()).toBeNull()
  })

  it('does not invent a path when the unpacked directory is not there', () => {
    asMutable.resourcesPath = '/nowhere/in/particular'

    expect(binariesDirectory()).toBeNull()
  })

  it('gives every ffmpeg call the same options, so one cannot drift from the rest', () => {
    const options = ffOptions()

    expect(options).toMatchObject({ indent: false, logLevel: 'error' })
    expect(options).toHaveProperty('binariesDirectory')
  })
})
