#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("Node.js 24+ is required"); process.exit(1); }'
command -v ffmpeg >/dev/null
command -v ffprobe >/dev/null
npm --cache /tmp/shijian-npm-cache ci
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
.venv/bin/pip --cache-dir /tmp/shijian-pip-cache install -r worker/requirements-dev.txt
.venv/bin/pip check
npm test
.venv/bin/python -m pytest -q worker/tests --import-mode=importlib
npm run build
