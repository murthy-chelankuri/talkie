import { FPS, NARRATION_LEAD_IN_FRAMES } from '../../composition/constants'
import type { TimelineItem } from '../project/timeline/schema'
import type { NarrationBeat, TranscriptSegment } from './schema'

export interface Caption {
  /** Where the words start and stop, in frames of the finished video. */
  startFrame: number
  endFrame: number
  text: string
}

/**
 * The narration as something that can be read as well as heard.
 *
 * The timings are not guessed: a clip knows where it starts, narration is held back a fixed beat
 * so the picture is seen before it is spoken over, and the take's own length says when the words
 * stop. Everything needed was already on disk — nothing here asks a model or a service.
 *
 * A clip with no audio yet contributes nothing. Written words that have never been spoken are
 * not on the soundtrack, and a caption for them would be a subtitle for silence.
 */
export function buildCaptions(
  timeline: TimelineItem[],
  segments: TranscriptSegment[],
  secondsOf: (segment: TranscriptSegment) => number | undefined
): Caption[] {
  const captions: Caption[] = []

  for (const item of timeline) {
    const segment = segments.find((s) => s.timelineItemId === item.id)
    if (!segment?.audioFile || !segment.text.trim()) continue

    const seconds = secondsOf(segment)
    if (!seconds || seconds <= 0) continue

    const startFrame = item.start + NARRATION_LEAD_IN_FRAMES
    // Never past the clip's own end: a caption outliving its picture would sit over the next one.
    const endFrame = Math.min(item.start + item.duration, startFrame + Math.round(seconds * FPS))
    if (endFrame <= startFrame) continue

    // A timed take already says when each thing is said, so its cues are placed rather than
    // guessed — and a caption that sat over a sixteen-second wait for data was the clearest sign
    // that the words and the picture had come apart. See narrationBeats.ts.
    if (segment.beats && segment.beats.length > 1) {
      captions.push(...cuesFromBeats(segment.beats, item, endFrame))
      continue
    }

    // Long narration becomes several cues rather than one that sits on screen for nine seconds.
    // Time is shared out by length, which is as close to the speech as the take's own duration
    // allows without measuring the audio word by word.
    const parts = splitIntoCues(segment.text.trim())
    const total = parts.reduce((sum, part) => sum + part.length, 0) || 1
    let cursor = startFrame

    parts.forEach((part, index) => {
      const share = Math.round(((endFrame - startFrame) * part.length) / total)
      const last = index === parts.length - 1
      const cueEnd = last ? endFrame : Math.min(endFrame, cursor + share)
      if (cueEnd > cursor) captions.push({ startFrame: cursor, endFrame: cueEnd, text: part })
      cursor = cueEnd
    })
  }

  return captions
}

/**
 * One cue per beat, starting where the beat does and ending where the next one begins.
 *
 * The beat times are what the take was assembled to, so these are the speech's own timings
 * rather than a share-out of the clip by sentence length.
 */
function cuesFromBeats(beats: NarrationBeat[], item: TimelineItem, endFrame: number): Caption[] {
  const cues: Caption[] = []

  for (const [index, beat] of beats.entries()) {
    const startFrame = item.start + Math.round(beat.at * FPS)
    const next = beats[index + 1]
    const stops = next ? item.start + Math.round(next.at * FPS) : endFrame
    if (stops <= startFrame || startFrame >= endFrame) continue

    for (const part of splitIntoCues(beat.text.replace(/\s+/g, ' ').trim())) {
      cues.push({ startFrame, endFrame: Math.min(stops, endFrame), text: part })
    }
  }

  // A beat long enough to need several cues shares its own window between them, rather than
  // stacking them all on the same frame.
  return cues.flatMap((cue, index, all) => {
    const sameWindow = all.filter((other) => other.startFrame === cue.startFrame)
    if (sameWindow.length === 1) return [cue]
    const position = sameWindow.indexOf(cue)
    const span = (cue.endFrame - cue.startFrame) / sameWindow.length
    return [
      {
        ...cue,
        startFrame: Math.round(cue.startFrame + span * position),
        endFrame: Math.round(cue.startFrame + span * (position + 1))
      }
    ]
  })
}

/**
 * A line of narration as the handful of cues it should be read in.
 *
 * Sentences first, because that is where a reader pauses anyway; a sentence too long for two
 * lines is then broken at a word. The alternative — one cue for the whole take — leaves a
 * paragraph sitting over the picture for the length of the clip.
 */
export function splitIntoCues(text: string, maxChars = 84): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g)?.map((part) => part.trim()) ?? [text]
  const cues: string[] = []
  let current = ''

  for (const sentence of sentences) {
    if (!sentence) continue

    if (current && `${current} ${sentence}`.length > maxChars) {
      cues.push(current)
      current = ''
    }

    if (sentence.length > maxChars) {
      if (current) {
        cues.push(current)
        current = ''
      }
      cues.push(...breakAtWords(sentence, maxChars))
      continue
    }

    current = current ? `${current} ${sentence}` : sentence
  }

  if (current) cues.push(current)
  return cues.length > 0 ? cues : [text]
}

function breakAtWords(sentence: string, maxChars: number): string[] {
  const parts: string[] = []
  let line = ''

  for (const word of sentence.split(/\s+/)) {
    if (line && `${line} ${word}`.length > maxChars) {
      parts.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) parts.push(line)
  return parts
}

/**
 * SubRip, which every player and every upload form understands.
 *
 * Written beside the video rather than burned into it, so the words stay correctable and stay
 * searchable — a caption burned into a picture cannot be fixed without rendering again.
 */
export function toSrt(captions: Caption[], fps: number = FPS): string {
  return captions
    .map((caption, index) =>
      [
        index + 1,
        `${srtTime(caption.startFrame / fps)} --> ${srtTime(caption.endFrame / fps)}`,
        wrapForReading(caption.text),
        ''
      ].join('\n')
    )
    .join('\n')
}

/**
 * Two lines at most, broken at a space.
 *
 * A caption wider than the picture is cropped by the player rather than wrapped, so the line
 * length is decided here instead of being left to whatever is showing the video.
 */
export function wrapForReading(text: string, perLine = 42): string {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''

  for (const word of words) {
    if (line && `${line} ${word}`.length > perLine) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)

  // More than two lines covers the picture, so the rest joins the second.
  if (lines.length <= 2) return lines.join('\n')
  return [lines[0], lines.slice(1).join(' ')].join('\n')
}

function srtTime(seconds: number): string {
  const whole = Math.max(0, seconds)
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const secs = Math.floor(whole % 60)
  const millis = Math.round((whole - Math.floor(whole)) * 1000)

  return (
    [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':') +
    ',' +
    String(millis).padStart(3, '0')
  )
}

/**
 * The same cues, grouped by the clip they belong to and counted from that clip's own start.
 *
 * That is the shape a composition wants: each clip is already a Sequence with its own frame
 * count, so a cue drawn inside it needs no knowledge of where the clip sits on the timeline.
 */
export function captionsByItem(
  timeline: TimelineItem[],
  segments: TranscriptSegment[],
  secondsOf: (segment: TranscriptSegment) => number | undefined
): Record<string, Caption[]> {
  const grouped: Record<string, Caption[]> = {}

  for (const item of timeline) {
    const cues = buildCaptions([item], segments, secondsOf)
    if (cues.length === 0) continue

    grouped[item.id] = cues.map((cue) => ({
      ...cue,
      startFrame: cue.startFrame - item.start,
      endFrame: cue.endFrame - item.start
    }))
  }

  return grouped
}

/**
 * The moments each clip's narration is spoken at, keyed by clip.
 *
 * Handed to the composition so a slide can bring in a line as it is mentioned. Only takes that
 * were timed have any: one read straight through says nothing about when anything is said, and
 * a slide with nothing to wait for falls back to a stagger.
 */
export function beatsByItem(segments: TranscriptSegment[]): Record<string, { at: number; text: string }[]> {
  const grouped: Record<string, { at: number; text: string }[]> = {}
  for (const segment of segments) {
    if (segment.beats && segment.beats.length > 0) grouped[segment.timelineItemId] = segment.beats
  }
  return grouped
}
