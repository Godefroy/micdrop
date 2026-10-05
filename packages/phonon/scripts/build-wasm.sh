#!/bin/sh
# Builds the WebAssembly module of Phonon into wasm/, from the
# gradium-ai/xn-ptts commit pinned below.
#
# Needs Rust with the wasm32-unknown-unknown target, wasm-pack 0.12 or later
# and binaryen's wasm-opt 124 or later on PATH.
set -e

REPO=https://github.com/gradium-ai/xn-ptts.git
COMMIT=207379d1ef55a6413a0b23329205183ef422ba97

cd "$(dirname "$0")/.."
OUT="$(pwd)/wasm"
SRC="${XN_PTTS_DIR:-$(pwd)/.xn-ptts}"

if [ ! -d "$SRC/.git" ]; then
  git clone --quiet "$REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$COMMIT"
git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$COMMIT"

# The single-threaded build: Node runs it on the worker thread of the package
cd "$SRC/ptts-wasm"
wasm-pack build --target web --no-pack --out-dir "$OUT" --out-name phonon_tts --release
rm -f "$OUT/.gitignore"
# The glue is an ES module, which Node reads without guessing when told so
echo '{ "type": "module" }' > "$OUT/package.json"
