/**
 * Every animation on the page, held at the video's moment.
 *
 * An animation the page made while loading starts with the scene, at 0. One made later — a class
 * added in onFrame, a timer that calls element.animate — starts at the moment it first appeared,
 * so it plays from there rather than jumping to its end.
 */
type Seekable = { seek(ms: number): void; pause?(): void }
type LottieLike = { goToAndStop(value: number, isFrame?: boolean): void }

const anime: Seekable[] = []
const lotties: LottieLike[] = []
const bornAt = new WeakMap<Animation, number>()
let seenAnyFrame = false

export function registerAnime(timeline: Seekable): void {
  timeline.pause?.()
  anime.push(timeline)
}

export function registerLottie(animation: LottieLike): void {
  lotties.push(animation)
}

export function settleAnimations(doc: Document, ms: number): void {
  for (const animation of doc.getAnimations()) {
    if (!bornAt.has(animation)) bornAt.set(animation, seenAnyFrame ? ms : 0)
    animation.pause()
    animation.currentTime = Math.max(0, ms - (bornAt.get(animation) ?? 0))
  }
  seenAnyFrame = true
  for (const timeline of anime) timeline.seek(ms)
  for (const animation of lotties) animation.goToAndStop(ms, false)
}
