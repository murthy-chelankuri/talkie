import { writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'

/**
 * `mode` is applied to the temporary file, which is the one that survives the rename — so a
 * file written this way is created with the permissions asked for rather than widened first and
 * narrowed afterwards.
 */
export function writeJsonAtomic(filePath: string, data: unknown, mode?: number): void {
  const tempPath = join(
    dirname(filePath),
    `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )

  writeFileSync(tempPath, JSON.stringify(data, null, 2), mode === undefined ? 'utf-8' : { encoding: 'utf-8', mode })
  renameSync(tempPath, filePath)
}
