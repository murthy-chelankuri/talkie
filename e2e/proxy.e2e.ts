import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'http'
import type { AddressInfo } from 'net'
import { launchTalkie, type Talkie } from './app'
import { makeFixture, type Fixture } from './fixture'

let fixture: Fixture
let talkie: Talkie
let proxy: Server | undefined

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  await new Promise<void>((resolve) => (proxy ? proxy.close(() => resolve()) : resolve()))
  proxy = undefined
  expect(errors, 'the window logged errors').toEqual([])
})

/**
 * A corporate proxy that refuses Hugging Face, and writes down every site it was asked for.
 *
 * The voice was once fetched with Node's own fetch, which never asks the system's proxy at all:
 * the browser on the same machine could reach the files and Talkie could not, and nothing that ran
 * without a proxy could tell. Here the proxy is the only way out, so the request reaching it is
 * the proof the download goes through the network the browser uses — and its refusal has to come
 * back to the person as a proxy, with somewhere to go next.
 */
function refusingProxy(): Promise<{ port: number; asked: string[] }> {
  const asked: string[] = []
  proxy = createServer((req, res) => {
    asked.push(req.url ?? '')
    res.writeHead(403).end()
  })
  proxy.on('connect', (req, socket) => {
    asked.push(req.url ?? '')
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n')
  })
  return new Promise((resolve) => proxy!.listen(0, '127.0.0.1', () => resolve({ port: (proxy!.address() as AddressInfo).port, asked })))
}

describe('behind a proxy', () => {
  it('asks the system proxy for the Kokoro voice, and says plainly when it refuses', async () => {
    const { port, asked } = await refusingProxy()
    fixture = makeFixture('system')
    talkie = await launchTalkie(fixture, { switches: [`--proxy-server=http://127.0.0.1:${port}`] })
    const { win } = talkie

    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByRole('button', { name: 'Download voice' }).click()

    await settings.getByText(/A proxy or firewall stopped the download/).waitFor({ timeout: 30_000 })
    expect(asked.some((site) => site.startsWith('huggingface.co')), `the proxy was asked for ${JSON.stringify(asked)}`).toBe(true)
    // And the way round it is right there.
    await settings.getByText('Download it yourself instead').waitFor()
  })
})
