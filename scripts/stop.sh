#!/usr/bin/env bash
# Stop the whole Tryout stack. DB data persists in Docker volumes.
# Usage:  bash scripts/stop.sh      (or: pnpm stop)
set -uo pipefail
cd "$(dirname "$0")/.."

echo "==> stopping Web + API (freeing :3000 / :3001)"
node scripts/free-port.mjs 3000 || true
node scripts/free-port.mjs 3001 || true

echo "==> stopping infra (Postgres + Redis)"
docker compose stop

echo "Tryout stopped. Data kept in volumes. Restart with: bash scripts/start.sh"
