import { homedir } from 'os'

/**
 * What a problem report must never carry, taken out of any text before it goes in one.
 *
 * A report describes Talkie and the machine, never the person's work, so nothing from a project
 * may reach it: no narration, no scene text, no project names. The log is written to hold none of
 * those, and this is the net beneath it — an error message can quote the words it failed on, and
 * a path names the project's folder. Secrets go too, whatever wrote them down.
 */
export function scrub(text: string, home: string = homedir()): string {
  let out = text
  // Before anything else, while the home folder is still recognisable in the paths.
  if (home && home !== '/') out = out.split(home).join('~')
  return (
    out
      // A project's folder is `<id>-<slug>`, and the slug is its name.
      .replace(/(Projects\/[0-9a-z]{6,})-[^/\s'"`)]+/gi, '$1')
      // Quoted words — what an error says it could not speak, a title it could not draw.
      .replace(/“[^”\n]{12,}”/g, '“[words removed]”')
      .replace(/"[^"\n]{24,}"/g, (quoted) => (/[ ]/.test(quoted) && !/^"(\/|~|https?:)/.test(quoted) ? '"[words removed]"' : quoted))
      // Keys and tokens, in the shapes the providers Talkie talks to hand them out in.
      .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[secret removed]')
      .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[secret removed]')
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/g, '$1 [secret removed]')
      .replace(/\b(TALKIE_MCP_TOKEN|ANTHROPIC_API_KEY|apiKey|token)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[secret removed]')
      // The asset server's per-run secret, which every media address carries.
      .replace(/((?:127\.0\.0\.1|localhost):\d+\/)[0-9a-f]{32}/g, '$1[secret removed]')
  )
}
