'use strict'

// See README.md. Present so transformers.js loads; called only to process an image, which the
// Kokoro voice never does.
module.exports = function sharp() {
  throw new Error('Talkie ships without sharp: there is no image processing in the Kokoro worker.')
}
