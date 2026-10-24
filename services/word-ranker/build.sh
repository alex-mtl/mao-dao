#!/bin/sh
# Build build/word-ranker-<lang>.zip: handler + numpy (Linux wheel) + that language's dictionaries.
# By default the dictionaries are the finished ones kept in stream-engine/word-data/built (the versions in
# production, see stream-engine/word-data/README.md): nothing is rebuilt or downloaded.
# REBUILD=1 ./build.sh rebuilds them with the game's Dockerfile ("assets" stage, local data of word-data/ only;
# GAME_DIR=/path overrides the folder of that Dockerfile). build/assets is also what the tests mount as /app/assets.
cd "$(dirname "$0")" && rm -rf build && mkdir -p build
if [ -n "$REBUILD" ]; then
  GAME_DIR=${GAME_DIR:-../../stream-engine}
  docker build -q --target assets -t election-game-assets "$GAME_DIR" >/dev/null || exit 1
  id=$(docker create election-game-assets) && docker cp "$id:/assets" build/assets >/dev/null && docker rm "$id" >/dev/null
else
  cp -r ../../stream-engine/word-data/built build/assets || exit 1
fi
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim sh -c '
pip install -q --no-cache-dir --platform manylinux2014_x86_64 --only-binary=:all: --python-version 3.12 numpy==2.2.6 -t build/numpy-pkg 2>&1 | grep -v "^\[notice\]"
python - <<PY
import glob, os, zipfile
for lang in ("en", "ru", "fr", "es"):
    out = f"build/word-ranker-{lang}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write("handler.py", "handler.py")
        for f in glob.glob("build/numpy-pkg/**", recursive=True):
            if os.path.isfile(f) and "__pycache__" not in f:
                z.write(f, os.path.relpath(f, "build/numpy-pkg"))
        for d in (lang, lang + "-easy", lang + "-hard"):
            for name in ("vocab.txt", "embeddings.npy"):
                p = f"build/assets/{d}/{name}"
                if os.path.exists(p):
                    z.write(p, f"assets/{d}/{name}")
    print(out, round(os.path.getsize(out) / 2**20, 1), "MB")
PY'
