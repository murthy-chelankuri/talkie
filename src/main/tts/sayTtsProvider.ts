import { execFile } from 'child_process'
import { promisify } from 'util'
import { unlinkSync } from 'fs'
import type { TTSProvider } from './ttsProvider'

const execFileAsync = promisify(execFile)

export const sayTtsProvider: TTSProvider = {
  async synthesize(text: string, outputPath: string): Promise<void> {
    const aiffPath = outputPath.replace(/\.wav$/, '.aiff')

    await execFileAsync('say', ['-o', aiffPath, text])
    await execFileAsync('afconvert', ['-f', 'WAVE', '-d', 'LEI16', aiffPath, outputPath])

    unlinkSync(aiffPath)
  }
}
