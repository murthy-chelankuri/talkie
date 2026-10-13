import { cpus } from 'os'

/** Half the cores, one to six: each tab is a browser renderer and an ffmpeg encoding beside it. */
export function tabCount(cores: number = cpus().length): number {
  return Math.min(6, Math.max(1, Math.floor(cores / 2)))
}

/** Consecutive runs, as equal as frames allow, so each tab's recording decoder only goes forward. */
export function splitFrames(total: number, tabs: number): { from: number; to: number }[] {
  const count = Math.max(1, Math.min(tabs, total))
  const ranges: { from: number; to: number }[] = []
  for (let i = 0; i < count; i++) {
    ranges.push({ from: Math.round((total * i) / count), to: Math.round((total * (i + 1)) / count) })
  }
  return ranges
}
