#!/usr/bin/env bash
# Run once per clone: git will use .githooks/ so pre-commit updates "Last updated" automatically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
git config core.hooksPath .githooks
echo "core.hooksPath set to .githooks (pre-commit will bump Last updated in index.html)."
