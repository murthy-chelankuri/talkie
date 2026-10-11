import { LIBRARY_TOKEN } from './import'

/**
 * What a scene page may reach: its own folder and Talkie's runtime and libraries, and nothing else
 * — above all no network (`connect-src 'none'`), so a page cannot send anything anywhere even
 * though its own address carries the asset server's secret. `'unsafe-eval'` because lottie-web
 * evaluates After Effects expressions; inside the sandbox it reaches nothing more.
 */
export function scenePolicy(sceneFolderUrl: string, base: string): string {
  const talkie = `${base}/__talkie/`
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' ${sceneFolderUrl} ${talkie}`,
    `style-src 'unsafe-inline' ${sceneFolderUrl} data:`,
    `img-src ${sceneFolderUrl} data: blob:`,
    `font-src ${sceneFolderUrl} data:`,
    `media-src ${sceneFolderUrl} data: blob:`,
    "connect-src 'none'",
    "frame-src 'none'",
    'worker-src blob:',
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'"
  ].join('; ')
}

/** The runtime first in <head>, so it owns the clock before the page's own code reads it. */
export function injectRuntime(html: string, base: string): string {
  const tag = `<script src="${base}/__talkie/runtime.js"></script>`
  const withLibraries = html.split(LIBRARY_TOKEN).join(`${base}/__talkie/lib/`)
  if (/<head\b[^>]*>/i.test(withLibraries)) return withLibraries.replace(/<head\b[^>]*>/i, (open) => `${open}${tag}`)
  return `<head>${tag}</head>${withLibraries}`
}
