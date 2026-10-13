/**
 * Everything Talkie does with ffmpeg and ffprobe goes through here: finding them, running them,
 * measuring media, choosing an encoder. Nothing else spawns them (mediaBoundary.test.ts), so the
 * binaries, their location in a packaged build and the encoders per system are one module's
 * business, and Windows and Linux are rows added here rather than call sites hunted down.
 */
export { toolPath, ffmpegPath, ffprobePath, packagedResources, type MediaTool } from './binaries'
export { runFfmpeg, runFfprobe, type ToolOutput } from './run'
export { probeMedia, type MediaInfo } from './probe'
export { h264, chooseH264, type EncodePurpose } from './encoders'
