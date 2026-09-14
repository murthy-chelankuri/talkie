import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'https'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createProject } from '../project/projectApi'
import { updateSettings } from '../settings/settingsStore'
import { startRecordingSession } from './recordSession'

/** A certificate no machine has any reason to trust — the situation this setting is for. */
function selfSignedServer(): Promise<{ url: string; server: Server }> {
  const dir = mkdtempSync(join(tmpdir(), 'talkie-self-signed-'))
  // Piped, not inherited: openssl draws a wall of progress dots while it finds a prime.
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(dir, 'key.pem'),
      '-out',
      join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost'
    ],
    { stdio: 'pipe' }
  )

  const server = createServer(
    { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('<!doctype html><body style="margin:0;font:48px sans-serif">local build</body>')
    }
  )

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      rmSync(dir, { recursive: true, force: true })
      resolve({ url: `https://localhost:${port}/`, server })
    })
  })
}

describe('recording a site whose certificate is not trusted', () => {
  let url: string
  let server: Server

  beforeAll(async () => {
    ;({ url, server } = await selfSignedServer())
  })

  afterAll(() => {
    server.close()
  })

  it('refuses by default, and says which setting would allow it', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-cert-refused-'))
    const project = createProject('Refused', baseDir)

    await expect(startRecordingSession(project.id, url, baseDir)).rejects.toThrow(
      /certificate is not trusted.*Settings → Recording/s
    )

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)

  it('records it once the person has said that is what they want', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-cert-allowed-'))
    const project = createProject('Allowed', baseDir)
    updateSettings({ recording: { allowUntrustedCertificates: true } }, baseDir)

    const session = await startRecordingSession(project.id, url, baseDir)
    expect(session.page.url()).toBe(url)
    await session.page.waitForTimeout(600)

    const { clips } = await session.stop()
    expect(clips).toHaveLength(1)

    rmSync(baseDir, { recursive: true, force: true })
  }, 60_000)
})
