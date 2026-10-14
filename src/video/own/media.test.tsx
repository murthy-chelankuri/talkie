// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, render } from '@testing-library/react'
import { VideoRoot } from './clock'
import { openHoldCount, resetHolds, whenSettled } from './hold'
import { Picture, chooseOwnRenderer } from '../index'
import { OwnFootage, OwnPicture, OwnSound, footageFrameUrl } from './media'

afterEach(() => resetHolds())

const root = (frame: number, children: JSX.Element): JSX.Element => (
  <VideoRoot frame={frame} fps={30} width={1920} height={1080} durationInFrames={300} mode="export">
    {children}
  </VideoRoot>
)

describe('Talkie’s own media', () => {
  it('holds the frame until a picture has loaded', async () => {
    const view = render(root(0, <OwnPicture src="http://127.0.0.1:1/s/p/a.png" />))
    expect(openHoldCount()).toBe(1)
    const img = view.container.querySelector('img')!
    // jsdom loads nothing; this stands in for the browser saying it has.
    Object.defineProperty(img, 'decode', { value: () => Promise.resolve() })
    await act(async () => void img.dispatchEvent(new Event('load')))
    expect(openHoldCount()).toBe(0)
  })

  it('asks the asset server for the recording’s frame at the clip’s moment', () => {
    const view = render(root(10, <OwnFootage src="http://127.0.0.1:1/s/p/rec.mp4" trimBefore={45} />))
    expect(view.container.querySelector('img')!.getAttribute('src')).toBe(footageFrameUrl('http://127.0.0.1:1/s/p/rec.mp4', 55, ''))
  })

  it('draws nothing past trimAfter, where the next scene of the same recording begins', () => {
    const view = render(root(20, <OwnFootage src="http://127.0.0.1:1/s/p/rec.mp4" trimBefore={45} trimAfter={60} />))
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('names the frame and the reader in the URL, keeping any query the URL had', () => {
    expect(footageFrameUrl('http://h/s/rec.mp4', 7, 'ab12-3')).toBe('http://h/s/rec.mp4?frame=7&reader=ab12-3')
    expect(footageFrameUrl('http://h/s/rec.mp4?v=2', 7, 'r')).toBe('http://h/s/rec.mp4?v=2&frame=7&reader=r')
  })

  it('plays no sound in the picture: the export mixes the soundtrack from the timeline', () => {
    expect(render(root(0, <OwnSound src="http://h/a.wav" />)).container.innerHTML).toBe('')
  })

  it('fails the export at once, and lets go of the hold, when a picture cannot be loaded', async () => {
    const view = render(root(0, <OwnPicture src="http://127.0.0.1:1/s/p/missing.png" />))
    await act(async () => void view.container.querySelector('img')!.dispatchEvent(new Event('error')))
    expect(openHoldCount()).toBe(0)
    await expect(whenSettled()).rejects.toThrow('Could not load missing.png')
  })

  it('lets go of its hold when it is unmounted before the picture arrives', () => {
    const view = render(root(0, <OwnPicture src="http://127.0.0.1:1/s/p/a.png" />))
    expect(openHoldCount()).toBe(1)
    view.unmount()
    expect(openHoldCount()).toBe(0)
  })

  it('holds again for a new src on the same Picture, until that image has loaded', async () => {
    chooseOwnRenderer()
    const loadIt = async (container: HTMLElement): Promise<void> => {
      const img = container.querySelector('img')!
      Object.defineProperty(img, 'decode', { value: () => Promise.resolve() })
      await act(async () => void img.dispatchEvent(new Event('load')))
    }
    const view = render(root(0, <Picture src="http://h/a.png" />))
    await loadIt(view.container)
    expect(openHoldCount()).toBe(0)
    view.rerender(root(0, <Picture src="http://h/b.png" />))
    expect(openHoldCount()).toBe(1)
    await loadIt(view.container)
    expect(openHoldCount()).toBe(0)
  })
})

const preview = (frame: number, children: JSX.Element): JSX.Element => (
  <VideoRoot frame={frame} fps={30} width={1920} height={1080} durationInFrames={300} mode="preview">
    {children}
  </VideoRoot>
)

describe('Talkie’s own media in the preview', () => {
  it('plays a recording as a video, not a still frame', () => {
    const view = render(preview(10, <OwnFootage src="http://h/rec.mp4" trimBefore={45} />))
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe('http://h/rec.mp4')
    expect(view.container.querySelector('img')).toBeNull()
  })

  it('draws no video past trimAfter, where the next scene of the same recording begins', () => {
    const view = render(preview(20, <OwnFootage src="http://h/rec.mp4" trimBefore={45} trimAfter={60} />))
    expect(view.container.querySelector('video')).toBeNull()
  })

  it('plays narration as audio rather than nothing', () => {
    const view = render(preview(0, <OwnSound src="http://h/a.wav" />))
    expect(view.container.querySelector('audio')!.getAttribute('src')).toBe('http://h/a.wav')
  })
})
