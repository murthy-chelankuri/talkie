import { writeFileSync, renameSync } from 'fs'
import { dirname, join } from 'path'

export function writeJsonAtomic(filePath: string, data: unknown): void {
  const tempPath = join(
    dirname(filePath),
    `.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  )

  writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tempPath, filePath)
}
