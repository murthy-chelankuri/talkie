import { dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { checkReadiness, type ReadinessCheck } from '../setup/readiness'
import { runDoctor, type DoctorCheck } from '../diagnostics/doctor'
import { gatherReport, issueUrl, writeReportZip } from '../diagnostics/report'

export type ReportOutcome = { status: 'saved'; path: string } | { status: 'cancelled' }

/** The window's readiness list in the doctor's shape, so a report has one list of checks. */
export function asDoctorCheck(check: ReadinessCheck): DoctorCheck {
  return {
    id: check.id,
    label: check.label,
    ok: check.ready ? true : check.required ? false : null,
    detail: check.detail ?? check.purpose,
    fix: check.ready ? undefined : check.fix
  }
}

/** "Problem: Narration stops after the first clip", from the first line of what they wrote. */
export function issueTitle(description: string): string {
  const first = description.trim().split('\n')[0].trim()
  if (!first) return 'Problem report'
  return `Problem: ${first.length > 80 ? `${first.slice(0, 77)}…` : first}`
}

function reportName(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `Talkie report ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}.${pad(now.getMinutes())}.zip`
}

export function registerDiagnosticsHandlers(ipcMain: IpcMain, getWindow: () => BrowserWindow | null): void {
  /**
   * Gathers a report, has the person choose where it goes, shows it in Finder and opens a new
   * issue with the summary filled in for them to attach it to. Nothing is sent by Talkie: the
   * person reads it, and posts it, themselves.
   */
  ipcMain.handle('settings:diagnostics:report', async (_event, description: string): Promise<ReportOutcome> => {
    const [readiness, doctor] = await Promise.all([checkReadiness(), runDoctor({ speak: true })])
    const report = gatherReport({ description, checks: [...doctor, ...readiness.map(asDoctorCheck)] })

    const window = getWindow()
    const options = { defaultPath: join(homedir(), 'Desktop', reportName()), filters: [{ name: 'Zip', extensions: ['zip'] }] }
    const chosen = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (chosen.canceled || !chosen.filePath) return { status: 'cancelled' }

    writeReportZip(report, chosen.filePath)
    shell.showItemInFolder(chosen.filePath)
    await shell.openExternal(issueUrl(report, issueTitle(description)))
    return { status: 'saved', path: chosen.filePath }
  })
}
