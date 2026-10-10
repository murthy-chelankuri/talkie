# sharp, left out

`@huggingface/transformers` depends on `sharp` for image processing, and loads it on startup.
Talkie uses transformers.js only to run the Kokoro voice, which never touches an image.

The real `sharp` brings `@img/sharp-libvips-*`: one 16 MB library holding about thirty others,
eight of them LGPL-3.0 (libvips, glib, pango, librsvg and more), cairo under MPL-2.0, and libaom
under a patent licence. Shipping it would mean shipping all of their licence texts and offering
their source with every build — for code that is never called.

So `package.json` overrides `sharp` with this package. transformers.js finds something to load;
the only thing it ever does is throw, if an image is ever asked of it. Nothing in Talkie asks.

Remove the override, and this folder, only if Talkie starts using transformers.js for images —
and then read NOTICE first.
