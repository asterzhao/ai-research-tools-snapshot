#!/usr/bin/env bash
# Rewrites the "Last updated: …" line in index.html (e.g. 19 April 2026).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LAST="$(date +"%d %B %Y")"
# Keep one space before the middle dot (·); [^·]* ends at the character before ·.
if sed --version 2>/dev/null | grep -q GNU; then
  sed -i "s/Last updated: [^·]*/Last updated: ${LAST} /" index.html
else
  sed -i '' "s/Last updated: [^·]*/Last updated: ${LAST} /" index.html
fi
