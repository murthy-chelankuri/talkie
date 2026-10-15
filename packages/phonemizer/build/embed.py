"""Turn eSpeak NG's stock Emscripten worker into the one module phonemizer imports.

    python3 -I embed.py <espeakng.worker.js> <espeakng.worker.data> <out.js>

The stock build fetches its data package from beside itself at run time. A module that has to
work bundled, from inside an Electron archive and in a plain Node process has nowhere reliable
to fetch from, so the package goes inside the file instead — gzip, then base64, inflated with
DecompressionStream, the same shape as the worker phonemizer 1.2.1 shipped. Nothing else in the
stock output is touched, so what runs is eSpeak NG's own build and this file can be read as a
diff against it.

The gzip carries no timestamp and no file name, so the same inputs make the same bytes.
"""

import base64
import gzip
import sys

LOADER_START = 'function fetchRemotePackage(packageName,packageSize,callback,errback){'
LOADER_END = 'function handleError(error){'

# Same signature as the function it replaces; the stock caller passes the package's name and
# size, which mean nothing once the package is in the file.
EMBEDDED_LOADER = (
    'function fetchRemotePackage(packageName,packageSize,callback,errback){'
    'const gzipped=Uint8Array.from(atob(WORKER_DATA),c=>c.charCodeAt(0));'
    'new Response(new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip")))'
    '.arrayBuffer().then(callback,errback)}'
)


def main(worker_path: str, data_path: str, out_path: str) -> None:
    with open(worker_path, encoding='utf-8') as f:
        worker = f.read()
    with open(data_path, 'rb') as f:
        data = f.read()

    # Exactly one of each, or the stock output has changed shape and this would splice blind.
    for marker in (LOADER_START, LOADER_END):
        count = worker.count(marker)
        if count != 1:
            sys.exit(f'embed.py: expected one {marker!r} in the stock worker, found {count}')
    start = worker.index(LOADER_START)
    end = worker.index(LOADER_END, start)

    gzipped = gzip.compress(data, compresslevel=9, mtime=0)
    encoded = base64.b64encode(gzipped).decode('ascii')

    out = (
        '// @ts-nocheck\n'
        '/*! eSpeak NG, built from source for Talkie. GPL-3.0-or-later; see COPYING and BUILD.md. */\n'
        f'const WORKER_DATA = "{encoded}";\n'
        + worker[:start]
        + EMBEDDED_LOADER
        + worker[end:]
        + '\nexport default Module;\n'
    )

    if 'require(' in out:
        sys.exit('embed.py: the worker still calls require(), which an ES module does not have')

    with open(out_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)


if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
