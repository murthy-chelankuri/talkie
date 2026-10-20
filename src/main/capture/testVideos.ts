import { h264, runFfmpeg } from '../media'
import { FPS } from '../../composition/constants'

/**
 * Three shots — 6s, 7s and 8s, each a different picture — with a tone that stops for a moment at
 * 9s and 16s: a video someone edited, with speech that pauses between sentences.
 */
export async function editedVideo(path: string, codec: 'h264' | 'prores' = 'h264'): Promise<void> {
  await runFfmpeg([
    '-f', 'lavfi', '-i', `testsrc2=s=640x360:r=${FPS}:d=6`,
    '-f', 'lavfi', '-i', `smptebars=s=640x360:r=${FPS}:d=7`,
    '-f', 'lavfi', '-i', `mandelbrot=s=640x360:r=${FPS},trim=duration=8`,
    '-f', 'lavfi', '-i', 'sine=f=440:d=21',
    '-filter_complex',
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v];[3:a]volume='if(between(t,9,9.8)+between(t,16,16.6),0,1)':eval=frame[a]",
    '-map', '[v]', '-map', '[a]',
    ...(codec === 'h264' ? await h264('intermediate') : ['-c:v', 'prores_ks']),
    '-c:a', 'aac', '-y', path
  ])
}
