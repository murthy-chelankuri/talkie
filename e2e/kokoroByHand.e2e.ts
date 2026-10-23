import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { launchTalkie, type Talkie } from './app'
import { kokoroAvailable, makeFixture, type Fixture } from './fixture'
import { KOKORO_FILES, kokoroModelDir } from '../src/main/tts/kokoro/kokoroModel'

let fixture: Fixture
let talkie: Talkie

afterEach(async () => {
  const errors = talkie?.errors ?? []
  await talkie?.close()
  fixture?.dispose()
  expect(errors, 'the window logged errors').toEqual([])
})

const SCREENSHOT = process.env.TALKIE_E2E_SCREENSHOT

/**
 * The Kokoro voice, brought in by hand where a proxy keeps the app from Hugging Face.
 *
 * The fixture's home has no voice, which is the proxy's case: the download offered and nothing
 * on disk. The files are "downloaded" by borrowing the ones already here, under the names a
 * browser gives them, and handed over through the file dialog — answered here, since a person is
 * the one who would pick them.
 */
describe('the Kokoro voice, added by hand', () => {
  it.skipIf(!kokoroAvailable())('links each file, takes them however they were named, and makes Kokoro ready', async () => {
    fixture = makeFixture()
    const downloads = join(fixture.home, 'Downloads')
    mkdirSync(downloads)
    const chosen = KOKORO_FILES.map((file, index) => {
      const saved = join(downloads, `download (${index}).${file.path.split('.').pop()}`)
      copyFileSync(join(kokoroModelDir(homedir()), file.path), saved)
      return saved
    })

    talkie = await launchTalkie(fixture)
    const { app, win } = talkie
    await app.evaluate(({ dialog }, paths) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog
    }, chosen)

    await win.getByRole('button', { name: 'Settings' }).click()
    const settings = win.getByRole('dialog', { name: 'Settings' })
    await settings.getByText('Download it yourself instead').click()

    const links = settings.getByRole('link', { name: /\.(json|onnx)$/ })
    await expect.poll(() => links.count()).toBe(4)
    expect(await settings.getByRole('link', { name: 'onnx/model_fp16.onnx' }).getAttribute('href')).toMatch(
      /^https:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/[0-9a-f]{40}\/onnx\/model_fp16\.onnx$/
    )
    if (SCREENSHOT) {
      await settings.getByRole('button', { name: 'Check the files' }).scrollIntoViewIfNeeded()
      await settings.screenshot({ path: SCREENSHOT })
    }

    await settings.getByRole('button', { name: /Choose downloaded files/ }).click()

    // Ready, and so no longer offered for download.
    await settings.getByRole('button', { name: 'Download voice' }).waitFor({ state: 'detached', timeout: 30_000 })
    for (const file of KOKORO_FILES) {
      expect(existsSync(join(kokoroModelDir(fixture.home), file.path)), file.path).toBe(true)
    }
  }, 90_000)
})
