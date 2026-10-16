/**
 * How long a described scene should run, in seconds, from what a person types: "10s", "2 min",
 * "1:30", "90", "2.5 minutes". Null for anything that is not a length.
 */
export function parseLength(text: string): number | null {
  const value = text.trim().toLowerCase()
  if (!value) return null
  const clock = /^(\d+):([0-5]\d)$/.exec(value)
  if (clock) return within(Number(clock[1]) * 60 + Number(clock[2]))
  const spoken = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|s|sec|secs|seconds?)?$/.exec(value)
  if (!spoken) return null
  const amount = Number(spoken[1])
  return within(spoken[2]?.startsWith('m') ? amount * 60 : amount)
}

/**
 * A length said in the description itself — "a 5 min animation of…", "30 seconds on…" — for when
 * the length box is left empty. A scene asked for as five minutes long was made five seconds long,
 * and the page paced for that.
 */
export function lengthInDescription(description: string): number | null {
  const said = /(\d+(?:\.\d+)?)[\s-]*(minutes?|mins?|min|seconds?|secs?|sec)\b/i.exec(description)
  return said ? parseLength(`${said[1]} ${said[2]}`) : null
}

/** From a second to half an hour: a length outside that is a typing slip, not a scene. */
function within(seconds: number): number | null {
  return seconds >= 1 && seconds <= 30 * 60 ? seconds : null
}
