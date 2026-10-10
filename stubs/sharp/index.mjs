// See README.md and index.cjs.
export default function sharp() {
  throw new Error('Talkie ships without sharp: there is no image processing in the Kokoro worker.')
}
