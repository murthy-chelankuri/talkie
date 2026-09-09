import { useEffect, useState } from 'react'
import { Player } from '@remotion/player'
import { projectClient, timelineClient, renderClient, captureClient, type ProjectMetadata, type TimelineItem } from '../api/projectClient'
import { DemoComposition } from '../../../remotion/DemoComposition'
import { FPS, WIDTH, HEIGHT } from '../../../remotion/constants'
import { computeTimelineDuration } from '../../../remotion/timelineDuration'
import type { TimelineItem as RemotionTimelineItem } from '../../../remotion/types'

export function Editor({ projectId }: { projectId: string }): JSX.Element {
  const [project, setProject] = useState<ProjectMetadata | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([projectClient.open(projectId), timelineClient.read(projectId)])
      .then(([openedProject, items]) => {
        setProject(openedProject)
        setTimeline(items)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }, [projectId])

  async function handleImportImage(): Promise<void> {
    setImportError(null)
    try {
      const item = await projectClient.importImage(projectId)
      if (item) {
        setTimeline(await timelineClient.read(projectId))
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  async function handleExport(): Promise<void> {
    setExporting(true)
    setExportError(null)
    try {
      const path = await renderClient.exportVideo(projectId)
      setExportedPath(path)
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
    } finally {
      setExporting(false)
    }
  }

  async function handleRecordSession(): Promise<void> {
    await captureClient.openToolbar(projectId)
  }

  if (error) return <div>{error}</div>
  if (!project) return <div>Loading…</div>

  // Cast: schema.ts's zod-inferred TimelineItem treats `data` as optional (z.unknown() accepts
  // undefined), while remotion/types.ts's hand-written TimelineItem requires it. Both describe
  // the same real shape validated by TimelineItemSchema.superRefine, so the optionality is a
  // static-typing artifact, not a runtime possibility. Same workaround as renderProject.ts /
  // timelineHandlers.ts.
  const remotionTimeline = timeline as unknown as RemotionTimelineItem[]

  return (
    <div style={{ display: 'grid', gridTemplateRows: '1fr auto', height: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 260px' }}>
        <aside>
          <p>Sources &amp; Agents</p>
          <button onClick={handleImportImage}>Import Image</button>
          {importError && <p style={{ color: 'red' }}>{importError}</p>}
          <button onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export Video'}
          </button>
          {exportError && <p style={{ color: 'red' }}>{exportError}</p>}
          {exportedPath && <p>Exported to: {exportedPath}</p>}
          <button onClick={handleRecordSession}>Record Session</button>
        </aside>
        <main>
          {timeline.length > 0 ? (
            <Player
              component={DemoComposition}
              inputProps={{ timeline: remotionTimeline }}
              durationInFrames={computeTimelineDuration(remotionTimeline)}
              fps={FPS}
              compositionWidth={WIDTH}
              compositionHeight={HEIGHT}
              style={{ width: '100%', height: '100%' }}
              controls
            />
          ) : (
            <p>Preview — {project.name}</p>
          )}
        </main>
        <aside>Transcript</aside>
      </div>
      <footer style={{ height: 160, display: 'flex', gap: 4 }}>
        {timeline.map((item) => (
          <div key={item.id} style={{ width: `${item.duration}px`, background: '#cfe8ff' }}>
            {item.kind}
          </div>
        ))}
      </footer>
    </div>
  )
}
