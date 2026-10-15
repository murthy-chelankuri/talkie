#!/bin/sh
# Rebuild eSpeak NG for phonemizer from its pinned source. See ../BUILD.md for what each step is
# for and what it produces; run it from anywhere, with Emscripten 3.1.74 active (emsdk_env.sh).
#
#   packages/phonemizer/build/build.sh
#
# Writes src/espeakng.worker.js and dist/phonemizer.cjs in this package and prints their hashes.
set -eu

COMMIT=b774a8fd712e2b43510c1cb6c2b8cd3f22fe0a86
ARCHIVE_SHA256=e080573e4e0f60c52b7ca9963a8ea52560500e47190bccf795f23986c299bdfd
EMSCRIPTEN_VERSION=3.1.74

HERE=$(cd "$(dirname "$0")" && pwd)
PACKAGE=$(dirname "$HERE")
REPO=$(cd "$PACKAGE/../.." && pwd)

# eSpeak NG keeps its data path in a 160-byte buffer and truncates anything longer without
# saying so; files then go missing from the compiled data. Hence a short directory, not a temp one.
WORK=${ESPEAK_WORK:-$HOME/.cache/te-build}
if [ ${#WORK} -gt 40 ]; then
  echo "build.sh: ESPEAK_WORK must be a short path (40 characters or fewer): $WORK" >&2
  exit 1
fi

command -v emcc >/dev/null || { echo "build.sh: emcc not found; source emsdk_env.sh for Emscripten $EMSCRIPTEN_VERSION" >&2; exit 1; }
emcc --version | head -1 | grep -q " $EMSCRIPTEN_VERSION " || {
  echo "build.sh: need Emscripten $EMSCRIPTEN_VERSION, found: $(emcc --version | head -1)" >&2
  exit 1
}
# autogen.sh calls libtoolize by its GNU name; Homebrew installs it as glibtoolize.
if [ -d /opt/homebrew/opt/libtool/libexec/gnubin ]; then
  PATH=/opt/homebrew/opt/libtool/libexec/gnubin:$PATH
fi

rm -rf "$WORK"
mkdir -p "$WORK/download" "$WORK/src"
curl -fsSL -o "$WORK/download/espeak-ng.tar.gz" "https://github.com/espeak-ng/espeak-ng/archive/$COMMIT.tar.gz"
echo "$ARCHIVE_SHA256  $WORK/download/espeak-ng.tar.gz" | shasum -a 256 -c -
tar -xzf "$WORK/download/espeak-ng.tar.gz" -C "$WORK/src" --strip-components=1

cd "$WORK/src"
# automake insists on ChangeLog; the source has CHANGELOG.md. On a case-insensitive disk the
# rename needs a stop in between.
for dir in . src/ucd-tools; do
  if [ -f "$dir/CHANGELOG.md" ] && [ ! -f "$dir/ChangeLog" ]; then
    mv "$dir/CHANGELOG.md" "$dir/changelog.tmp" && mv "$dir/changelog.tmp" "$dir/ChangeLog.md"
  fi
done

./autogen.sh >/dev/null

# Natively first, to compile English's phoneme tables and dictionary into espeak-ng-data. Xcode's
# linker refuses the -undefined dynamic_lookup libtool adds; this flag is what it takes instead.
./configure --prefix=/usr --without-async --without-mbrola --without-sonic \
  LDFLAGS="-Wl,-not_for_dyld_shared_cache" >/dev/null
make -j8 en >/dev/null

for patch in "$HERE"/patches/*.patch; do
  patch -p1 < "$patch"
done

# Then the library again, for Emscripten. espeak-ng-data survives the clean.
emconfigure ./configure --prefix=/usr --without-async --without-mbrola --without-sonic >/dev/null
emmake make clean >/dev/null
emmake make -j8 src/libespeak-ng.la >/dev/null

# eSpeak NG's own emscripten/Makefile, with three changes to its flags: --memory-init-file is gone
# from Emscripten, the tools are called through python3, and ENVIRONMENT leaves out the Node
# branch, whose require() calls an ES module does not have.
cd emscripten
emmake make \
  EM_LIBESPEAKNG=../src/.libs/libespeak-ng.a \
  'EM_WEBIDL_BINDER=python3 $(EMSCRIPTEN)/tools/webidl_binder.py' \
  'EM_FILE_PACKAGER=python3 $(EMSCRIPTEN)/tools/file_packager.py' \
  'EM_CXXFLAGS=-s RESERVED_FUNCTION_POINTERS=2 -s FORCE_FILESYSTEM=1 -s WASM=0 -s ERROR_ON_UNDEFINED_SYMBOLS=0 -s ENVIRONMENT=web,worker' \
  >/dev/null

python3 -I "$HERE/embed.py" js/espeakng.worker.js js/espeakng.worker.data "$PACKAGE/src/espeakng.worker.js"

cd "$PACKAGE"
"$REPO/node_modules/.bin/esbuild" src/phonemizer.js --bundle --platform=neutral --format=cjs \
  --minify-whitespace --legal-comments=inline --outfile=dist/phonemizer.cjs --log-level=warning

shasum -a 256 "$WORK/src/emscripten/js/espeakng.worker.data" src/espeakng.worker.js dist/phonemizer.cjs
