import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { createProject } from '../project/projectApi'
import { startRecordingSession } from './recordSession'
import { importRecordedSession } from './importRecordedSession'
import { readActionLog } from './actionLog'
import { onVideoClock, VIDEO_TIME_LOG } from './rebaseActionLog'

/** What one pixel of the video is, this many seconds in. */
function colourAt(videoPath: string, seconds: number): string {
  const raw = execFileSync(
    'ffmpeg',
    // -ss before -i seeks without decoding everything up to that point.
    ['-ss', seconds.toFixed(3), '-i', videoPath, '-frames:v', '1', '-vf', 'crop=2:2:100:100',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 20, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  const [r, g, b] = [raw[0], raw[1], raw[2]]
  if (r > 170 && g < 100 && b < 100) return 'red'
  if (g > 130 && r < 100 && b < 100) return 'green'
  if (r > 170 && g > 170 && b > 170) return 'white'
  return `other(${r},${g},${b})`
}

describe('the action log against the video it describes', () => {
  it('puts a click at the moment the video shows it, even across tabs', async () => {
    // The drafter reads the log against the video. A session that moved to a second tab used to
    // put every later action ahead of where it actually happened, because the waiting on the
    // first tab is not in the stitched video but was still in the log's idea of time.
    const baseDir = mkdtempSync(join(tmpdir(), 'talkie-log-clock-'))
    const project = createProject('Clock', baseDir)

    // The second tab turns red when its button is pressed, and green three seconds later.
    writeFileSync(
      join(baseDir, 'second.html'),
      `<!doctype html><body id="b" style="margin:0;background:#fff">
        <button id="go" style="position:absolute;left:40%;top:40%">go</button>
        <script>
          document.getElementById('go').onclick = () => {
            document.getElementById('b').style.background = '#e00000'
            setTimeout(() => { document.getElementById('b').style.background = '#00b000' }, 3000)
          }
        </script>
      </body>`
    )
    writeFileSync(join(baseDir, 'page.html'), '<!doctype html><body style="margin:0">first</body>')

    const session = await startRecordingSession(project.id, `file://${join(baseDir, 'page.html')}`, baseDir)
    // A long look at the first tab, which is the stretch that used to throw everything off.
    await session.page.waitForTimeout(5000)

    const second = await session.page.context().newPage()
    await second.goto(`file://${join(baseDir, 'second.html')}`)
    await second.bringToFront()
    await second.waitForTimeout(1500)
    await second.click('#go')
    await second.waitForTimeout(5000)

    const recording = await session.stop()
    expect(recording.clips).toHaveLength(2)

    const item = await importRecordedSession(project.id, recording, baseDir)
    const src = (item.data as { src: string }).src

    const click = readActionLog(join(src, '..', VIDEO_TIME_LOG)).find((e) => e.type === 'click')
    expect(click).toBeDefined()
    const at = click!.t / 1000

    // White just before the click, red just after, green three seconds on.
    expect(colourAt(src, at - 0.8)).toBe('white')
    expect(colourAt(src, at + 0.6)).toBe('red')
    expect(colourAt(src, at + 3.6)).toBe('green')

    // And the session log it came from still says when things happened in the session.
    const inSessionTime = readActionLog(recording.actionLogPath).find((e) => e.type === 'click')!
    expect(inSessionTime.t).toBeGreaterThan(click!.t)

    rmSync(baseDir, { recursive: true, force: true })
  }, 120_000)
})

describe('putting session time onto the video clock', () => {
  const clips = [
    { videoPath: 'a.webm', trimBeforeMs: 0, durationMs: 4000, fromSessionMs: 0 },
    { videoPath: 'b.webm', trimBeforeMs: 0, durationMs: 3000, fromSessionMs: 9000 }
  ]

  it('closes up the time nobody was watching', () => {
    const rebased = onVideoClock(
      [
        { t: 1000, type: 'click' },
        { t: 10_000, type: 'click' }
      ],
      clips
    )

    // The second click is a second into a stretch that begins four seconds into the video.
    expect(rebased.map((entry) => entry.t)).toEqual([1000, 5000])
  })

  it('drops what happened while no clip was being recorded', () => {
    // Between the two stretches the person was on a tab too briefly to keep, so there is no
    // moment in the video for anything logged then to belong to.
    expect(onVideoClock([{ t: 6000, type: 'click' }], clips)).toEqual([])
  })

  it('keeps an action at the very end of the last stretch', () => {
    expect(onVideoClock([{ t: 12_000, type: 'annotation', annotation: 'important' }], clips)).toHaveLength(1)
  })
})
