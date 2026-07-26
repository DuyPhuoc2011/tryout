#!/usr/bin/env bash
# Start the whole Tryout stack: Postgres + Redis (Docker), API, Web.
# Usage:  bash scripts/start.sh      (or: pnpm start)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p logs

DB="postgres://tryout:tryout@localhost:5432/tryout"

echo "==> infra (docker)"
docker compose up -d

echo "==> waiting for Postgres to be healthy..."
s=none
for _ in $(seq 1 30); do
  s=$(docker inspect -f '{{.State.Health.Status}}' tryout-postgres-1 2>/dev/null || echo none)
  [ "$s" = healthy ] && break
  sleep 2
done
[ "$s" = healthy ] || { echo "!! Postgres not healthy; aborting"; exit 1; }

echo "==> migrate"
DATABASE_URL="$DB" pnpm --filter @tryout/db migrate
# @tryout/db seed is a no-op stub post-marketplace-pivot; listings are authored
# via `pnpm --filter @tryout/db upsert-listing`. Kept as a cheap sanity call.
DATABASE_URL="$DB" pnpm --filter @tryout/db seed

echo "==> loading env from .env"
# Only the keys we need, and skip the GitHub placeholders (`<...>`) that break sourcing.
set -a
# Note: GITHUB_TOKEN/GITHUB_OWNER are sourced too, but only when they hold real
# values — a `<...>` placeholder would break the eval (bash sees `<` as a
# redirect), so those lines are filtered out and fall back to "placeholder".
eval "$(grep -E '^(DATABASE_URL|REDIS_URL|JWT_SECRET|LLM_PROVIDER|OPENAI_API_KEY|OPENAI_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|LLM_CHAT_MODEL|LLM_REVIEW_MODEL|NEXT_PUBLIC_API_URL|DAILY_RUN_LIMIT|METRICS_TOKEN|GITHUB_TOKEN|GITHUB_OWNER|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|WEB_BASE_URL)=' .env 2>/dev/null | grep -vE '=<' || true)"
set +a
export DATABASE_URL="${DATABASE_URL:-$DB}"
# Real GitHub PAT only needed for live repo creation; placeholders boot fine for dev.
export GITHUB_TOKEN="${GITHUB_TOKEN:-placeholder}"
export GITHUB_OWNER="${GITHUB_OWNER:-placeholder}"

# Free the ports first (api's start:dev also self-frees 3001).
node scripts/free-port.mjs 3000 >/dev/null 2>&1 || true
node scripts/free-port.mjs 3001 >/dev/null 2>&1 || true

echo "==> API on :3001"
nohup pnpm --filter @tryout/api start:dev > logs/api.log 2>&1 &
echo "==> Web on :3000"
NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://localhost:3001}" \
  nohup pnpm --filter @tryout/web dev > logs/web.log 2>&1 &

echo "==> waiting for services..."
api=000; web=000
for _ in $(seq 1 90); do
  api=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/ 2>/dev/null || true)
  web=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000 2>/dev/null || true)
  [ "${api:-000}" != 000 ] && [ "${web:-000}" != 000 ] && break
  sleep 2
done

echo
echo "Tryout up  (provider: ${LLM_PROVIDER:-anthropic}, model: ${LLM_CHAT_MODEL:-default})"
echo "  Web  http://localhost:3000   [$web]"
echo "  API  http://localhost:3001   [$api]"
echo "  logs: logs/api.log  logs/web.log"
{ [ "$api" != 000 ] && [ "$web" != 000 ]; } || echo "  (one service not responding yet - check the logs above)"
