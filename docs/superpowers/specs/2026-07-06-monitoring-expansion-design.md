# Monitoring Expansion — Dashboard, Uptime Checks, Log-Based Alerts

**Date:** 2026-07-06
**Status:** Approved
**Context:** Two production incidents on 2026-07-06 (Postgres disk full via `/filler`; Groq key sent to real OpenAI endpoint → 401 `invalid_api_key`) showed gaps: no uptime checks, no cause-specific alerts, no dashboard. Existing monitoring (`infra/terraform/monitoring.tf`) has an email channel, a generic API error-log spike alert, a Postgres disk >85% alert, and an API 5xx spike alert.

## Goal

Real ops coverage (not a drill): fastest useful visibility into tryout-api, tryout-web, and the Postgres VM, using only GCP-native Cloud Monitoring/Logging managed by the existing Terraform stack.

## Architecture

All new resources are appended to `infra/terraform/monitoring.tf`, following the resource patterns already in that file. No new tools, providers, or services. Data flow: Cloud Run / GCE → Cloud Logging + Cloud Monitoring ingest (already active) → log-based metrics → alert policies → existing email notification channel (`google_monitoring_notification_channel.email`). Dashboard reads the same metrics, read-only.

## Components

### 1. Uptime checks (2× `google_monitoring_uptime_check_config`)

| Check | Target | Path | Why |
|-------|--------|------|-----|
| api-health | tryout-api Cloud Run URL | `GET /health` | Handler runs `SELECT 1` against Postgres — one check covers API liveness + DB reachability |
| web-home | tryout-web Cloud Run URL | `GET /` | Confirms frontend serving |

HTTPS, default check frequency (60s), standard GCP checker regions.

### 2. Uptime alert (1× `google_monitoring_alert_policy`)

Fires when either check fails: `monitoring.googleapis.com/uptime_check/check_passed` fraction false, duration ~120s to absorb single-blip false positives. Notifies the existing email channel.

### 3. Cause-specific log alerts (2× `google_logging_metric` + 2× `google_monitoring_alert_policy`)

Matched to the two real incidents — no speculative matchers:

| Alert | Filter (on tryout-api ERROR logs) | Incident it names |
|-------|------------------------------------|-------------------|
| Postgres disk full | `textPayload =~ "No space left on device"` | 2026-07-06 disk-full |
| LLM auth failure | `textPayload =~ "invalid_api_key"` | 2026-07-06 Groq/OpenAI mismatch |

Threshold: count > 0 in 60s window — these are known-critical, alert immediately, no burst requirement. Email subject then names the actual cause instead of a generic "errors spiked."

### 4. Dashboard (1× `google_monitoring_dashboard`)

One dashboard, ~6 tiles (standard ops set):

1. Request count — api + web (`run.googleapis.com/request_count`)
2. Request latency p50/p95 — api (`run.googleapis.com/request_latencies`)
3. 5xx rate — api + web (request_count filtered `response_code_class="5xx"`)
4. Postgres VM disk % used (`agent.googleapis.com/disk/percent_used`)
5. Uptime check status (check_passed)
6. API error-log rate (existing `tryout_api_errors` log metric)

Defined as JSON in the Terraform resource.

## Error handling

- Log-metric filters use the exact strings observed in the incident logs; regex kept narrow to avoid false matches.
- Uptime alert duration 120s prevents single-network-blip pages; log alerts fire immediately by design.
- All alerts auto-close at 1800s, matching existing policies.

## Testing / verification

- `terraform plan` reviewed before apply.
- Post-apply: verify both uptime checks green in Cloud Console; verify dashboard renders all tiles with data.
- Alert firing not functionally tested (would require breaking prod on purpose); filter strings verified against actual incident log payloads captured 2026-07-06.

## Out of scope

- Tracing / APM
- Slack/PagerDuty channels (email only, as today)
- SLO / burn-rate alerts
- Web-service log-based alerts (web is static Next.js; api covers the failure surface)
