/**
 * Every animation on the page, held at the video's moment.
 *
 * An animation the page made itself while a frame was being drawn — a class added in onFrame, a
 * timer that calls element.animate — starts at that moment, so it plays from there rather than
 * jumping to its end. Every other animation counts from the scene's start, including the ones the
 * browser makes on its own: a style recalculation can replace a CSS animation with a fresh one at
 * any time, and that one belongs at the same moment as the one it replaced.
 */
type Seekable = { seek(ms: number): void; pause?(): void }
type LottieLike = { goToAndStop(value: number, isFrame?: boolean): void }

const anime: Seekable[] = []
const lotties: LottieLike[] = []
const bornAt = new WeakMap<Animation, number>()

export function registerAnime(timeline: Seekable): void {
  timeline.pause?.()
  anime.push(timeline)
}

export function registerLottie(animation: LottieLike): void {
  lotties.push(animation)
}

/** The animations there are before the page's own code runs for this frame. */
export function animationsBefore(doc: Document): Set<Animation> {
  return new Set(doc.getAnimations())
}

/** Animations the page made while this frame's callbacks ran start at this moment. */
export function noteNewAnimations(doc: Document, before: Set<Animation>, ms: number): void {
  for (const animation of doc.getAnimations()) {
    if (!before.has(animation) && !bornAt.has(animation)) bornAt.set(animation, ms)
  }
}

function target(animation: Animation, ms: number): number {
  return Math.max(0, ms - (bornAt.get(animation) ?? 0))
}

export async function settleAnimations(doc: Document, ms: number): Promise<void> {
  const animations = doc.getAnimations()
  const hold = (animation: Animation): void => {
    animation.pause()
    animation.currentTime = target(animation, ms)
  }
  animations.forEach(hold)
  // One still starting takes its time back from the clock once it is ready; hold it again then.
  await Promise.all(animations.map((animation) => animation.ready.then(hold, () => undefined)))
  for (const timeline of anime) timeline.seek(ms)
  for (const animation of lotties) animation.goToAndStop(ms, false)
}

/** Whether every animation is still held where this moment needs it — the browser may have replaced some. */
export function animationsHeld(doc: Document, ms: number): boolean {
  return doc
    .getAnimations()
    .every((animation) => animation.playState === 'paused' && Math.abs(Number(animation.currentTime) - target(animation, ms)) < 1)
}
