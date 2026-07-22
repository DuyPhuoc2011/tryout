#!/usr/bin/env bash
# Chaos injector for the Tryout SRE lab (docs/incidents/fault-catalog.md).
#
#   scripts/chaos.sh list                   # faults this script can inject
#   scripts/chaos.sh inject <fid>           # inject a specific fault
#   scripts/chaos.sh inject random [max_s]  # random fault after a random delay (blind)
#   scripts/chaos.sh recover                # undo whatever is active
#   scripts/chaos.sh status                 # is chaos active? (won't say which)
#   scripts/chaos.sh gauntlet               # Pass-2: every scripted fault in a row,
#                                           #   you diagnose each, Enter to recover+next
#
# Scripted faults: f01 f02 f08 f09 f13 f14 f15.
# Manual faults (need a rebuild/redeploy/secret change) stay in the catalog:
#   f03 bad deploy, f04 LLM, f05 GitHub, f06 latency, f07 secret,
#   f10 poll-max, f11 web build env, f12 Redis OOM.
set -euo pipefail

# gcloud.cmd mangles spaced args under Git Bash; the SDK's bash wrapper doesn't,
# but needs to be told where Python lives.
export CLOUDSDK_PYTHON="${CLOUDSDK_PYTHON:-C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\platform\\bundledpython\\python.exe}"
GCLOUD="${GCLOUD:-gcloud}"
PROJECT=tryout-sre-lab-260703
REGION=us-central1
ZONE=us-central1-a
VPC=tryout-vpc
REDIS_IP=10.200.119.187
DB_IP=10.10.0.2
VM=tryout-postgres
API=tryout-api
STATE="$HOME/.tryout-chaos-state"
SCRIPTED="f01 f02 f08 f09 f13 f14 f15"

vm_ssh() {
  $GCLOUD compute ssh "$VM" --zone="$ZONE" --project="$PROJECT" \
    --tunnel-through-iap --command="$1" 2>/dev/null
}

# Windows path to bash.exe, for the scheduled task's /TR. Order: explicit
# override -> cygpath (if present) -> known Git-for-Windows install literals.
# Needs no cygpath/pwd -W/GNU sed so it works across bash flavors on Windows.
resolve_bash_win() {
  if [ -n "${BASH_WIN:-}" ]; then echo "$BASH_WIN"; return 0; fi
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$(command -v bash)"; return 0; fi
  local pair m w
  for pair in \
    "/c/Program Files/Git/bin/bash.exe|C:\\Program Files\\Git\\bin\\bash.exe" \
    "/c/Program Files/Git/usr/bin/bash.exe|C:\\Program Files\\Git\\usr\\bin\\bash.exe" \
    "/c/Program Files (x86)/Git/bin/bash.exe|C:\\Program Files (x86)\\Git\\bin\\bash.exe"; do
    m=${pair%|*}; w=${pair#*|}
    [ -f "$m" ] && { echo "$w"; return 0; }
  done
  return 1
}

# --- f01: Redis unreachable (network partition) ---
inject_f01() {
  $GCLOUD compute firewall-rules create tryout-chaos-f01 --network="$VPC" \
    --direction=EGRESS --action=DENY --rules=tcp:6379 \
    --destination-ranges="$REDIS_IP/32" --priority=100 --project="$PROJECT" >/dev/null 2>&1
}
recover_f01() { $GCLOUD compute firewall-rules delete tryout-chaos-f01 --project="$PROJECT" -q >/dev/null 2>&1 || true; }

# --- f02: Postgres connection exhaustion (cap max_connections) ---
inject_f02() { vm_ssh "sudo -u postgres psql -c \"ALTER SYSTEM SET max_connections=5;\" && sudo systemctl restart postgresql"; }
recover_f02() { vm_ssh "sudo -u postgres psql -c \"ALTER SYSTEM RESET max_connections;\" && sudo systemctl restart postgresql" || true; }

# --- f08: VPC connector SPOF (block DB *and* Redis) ---
inject_f08() {
  $GCLOUD compute firewall-rules create tryout-chaos-f08 --network="$VPC" \
    --direction=EGRESS --action=DENY --rules=tcp:5432,tcp:6379 \
    --destination-ranges="$DB_IP/32,$REDIS_IP/32" --priority=90 --project="$PROJECT" >/dev/null 2>&1
}
recover_f08() { $GCLOUD compute firewall-rules delete tryout-chaos-f08 --project="$PROJECT" -q >/dev/null 2>&1 || true; }

# --- f09: scale-to-zero starves the in-process workers ---
inject_f09() { $GCLOUD run services update "$API" --min-instances=0 --region="$REGION" --project="$PROJECT" >/dev/null 2>&1; }
recover_f09() { $GCLOUD run services update "$API" --min-instances=1 --region="$REGION" --project="$PROJECT" >/dev/null 2>&1 || true; }

# --- f13: Postgres disk full ---
inject_f13() { vm_ssh "sudo fallocate -l 25G /filler"; }
recover_f13() { vm_ssh "sudo rm -f /filler" || true; }

# --- f14: Postgres process down ---
inject_f14() { vm_ssh "sudo systemctl stop postgresql"; }
recover_f14() { vm_ssh "sudo systemctl start postgresql" || true; }

# --- f15: VM OOM under 1GB RAM ---
inject_f15() { vm_ssh "which stress-ng >/dev/null 2>&1 || sudo apt-get install -y stress-ng >/dev/null 2>&1; nohup stress-ng --vm 2 --vm-bytes 95% --timeout 300s >/dev/null 2>&1 & echo started"; }
recover_f15() { vm_ssh "sudo pkill stress-ng; sudo systemctl start postgresql" || true; }

is_scripted() { case " $SCRIPTED " in *" $1 "*) return 0;; *) return 1;; esac; }

cmd="${1:-}"
case "$cmd" in
  list)
    echo "scripted (this tool): $SCRIPTED"
    echo "manual (see catalog):  f03 f04 f05 f06 f07 f10 f11 f12"
    ;;
  inject)
    fault="${2:-}"
    if [ "$fault" = "random" ]; then
      max="${3:-900}"; delay=$((RANDOM % max)); [ "$delay" -lt 60 ] && delay=60
      pick=$(echo $SCRIPTED | tr ' ' '\n' | shuf -n1)
      target=$(date -d "+$delay seconds" +%H:%M)
      bash_win=$(resolve_bash_win) || { echo "can't find bash.exe; set BASH_WIN=\"C:\\path\\to\\bash.exe\""; exit 1; }
      # Windows Task Scheduler one-shot; survives this shell dying (unlike nohup
      # under Git Bash). // stops MSYS from mangling the /flags into paths.
      tr_cmd="\"$bash_win\" -lc \"'$PWD/scripts/chaos.sh' inject-now $pick\""
      schtasks //Create //TN tryout-chaos //SC ONCE //ST "$target" //TR "$tr_cmd" //F >/dev/null
      echo "chaos armed via Task Scheduler: fires ~$target (~$((delay/60))m). Survives shell exit."
      exit 0
    fi
    is_scripted "$fault" || { echo "not scripted: $fault (run 'list')"; exit 1; }
    "$0" inject-now "$fault"
    ;;
  inject-now)
    fault="${2:?fault required}"
    date -u +"%Y-%m-%dT%H:%M:%SZ $fault" >> "$STATE"
    "inject_$fault"
    echo "chaos injected."   # deliberately doesn't say which
    ;;
  recover)
    # Disarm a pending scheduled fault first (armed-but-not-yet-fired).
    schtasks //Delete //TN tryout-chaos //F >/dev/null 2>&1 && echo "disarmed pending scheduled fault." || true
    [ -f "$STATE" ] || { echo "no active fault to recover."; exit 0; }
    while read -r ts fault; do
      echo "recovering $fault (injected at $ts)"
      "recover_$fault"
    done < "$STATE"
    rm -f "$STATE"
    echo "recovered."
    ;;
  status)
    armed=""; schtasks //Query //TN tryout-chaos >/dev/null 2>&1 && armed="ARMED (fault scheduled, not yet fired)"
    if [ -f "$STATE" ]; then echo "chaos ACTIVE (run 'recover')${armed:+ + $armed}"
    else echo "${armed:-no chaos active}"; fi
    ;;
  gauntlet)
    order=$(echo $SCRIPTED | tr ' ' '\n' | shuf | tr '\n' ' ')
    echo "Pass-2 gauntlet. Faults (shuffled, hidden order enforced by not printing)."
    for f in $order; do
      date -u +"%Y-%m-%dT%H:%M:%SZ $f" >> "$STATE"
      "inject_$f"
      start=$(date +%s)
      read -r -p "  >>> a fault is live. diagnose it, then press Enter to recover+next... "
      "recover_$f"
      : > "$STATE"
      echo "  recovered $f after $(( $(date +%s) - start ))s. It was: $f"
      echo
    done
    rm -f "$STATE"
    echo "gauntlet done."
    ;;
  *)
    grep '^#' "$0" | sed -n '2,20p'; exit 1
    ;;
esac
