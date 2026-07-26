#!/usr/bin/env bash
# Behavior harness for the Sam intake agent.
# Talks to a RUNNING api (real LLM) and prints Sam's reply + the extracted
# profile after every turn, then places the candidate.
#
# Needs the api running with a REAL provider key:
#   ANTHROPIC_API_KEY=sk-...           (LLM_PROVIDER=anthropic, default)
#   or LLM_PROVIDER=vertex + GCP ADC   (VERTEX_REGION / VERTEX_PROJECT_ID)
#
# Usage:
#   scripts/sam-chat.sh                 # runs the built-in scripted conversation
#   scripts/sam-chat.sh < my-turns.txt  # one candidate message per line
#
# Env: API=http://localhost:3001  PASS=password123
set -euo pipefail

API="${API:-http://localhost:3001}"
PASS="${PASS:-password123}"
EMAIL="sam-$(date +%s)@tryout.dev"

jqget() { python -c "import sys,json;print(json.load(sys.stdin)$1)"; }

echo "== signup $EMAIL =="
TOK=$(curl -s -X POST "$API/auth/signup" -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" | jqget "['token']")
auth=(-H "authorization: Bearer $TOK")

echo "== start intake =="
START=$(curl -s -X POST "$API/intake" "${auth[@]}")
ID=$(echo "$START" | jqget "['id']")
echo "Sam: $(echo "$START" | jqget "['transcript'][0]['content']")"
echo

# Candidate turns: from stdin if piped, else a default script.
if [ -t 0 ]; then
  TURNS=(
    "Hey Sam. I'm a junior backend dev, about a year of experience."
    "Mostly TypeScript and NestJS. Built a couple of REST APIs and a Postgres-backed scheduler."
    "I'm comfortable with API design and DB schemas. Weak on testing and CI."
    "I want to get better at writing maintainable code on a real team."
  )
else
  mapfile -t TURNS
fi

for msg in "${TURNS[@]}"; do
  [ -z "$msg" ] && continue
  echo "You: $msg"
  RES=$(curl -s -X POST "$API/intake/$ID/messages" "${auth[@]}" \
    -H 'content-type: application/json' -d "$(python -c "import json,sys;print(json.dumps({'content':sys.argv[1]}))" "$msg")")
  echo "Sam: $(echo "$RES" | jqget "['reply']")"
  echo "  profile: $(echo "$RES" | jqget "['profile']")"
  echo "  readyToPlace: $(echo "$RES" | jqget "['readyToPlace']")"
  echo
done

READY=$(echo "$RES" | jqget "['readyToPlace']")
if [ "$READY" = "True" ]; then
  echo "== place =="
  PLACE=$(curl -s -X POST "$API/intake/$ID/place" "${auth[@]}")
  echo "$PLACE" | python -m json.tool
else
  echo "Not ready to place after these turns (confidence below threshold / under turn cap)."
fi
