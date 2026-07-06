# Monitoring Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add uptime checks, cause-specific log alerts, and an ops dashboard for tryout-api/web/postgres, all in Terraform.

**Architecture:** Append resources to the existing `infra/terraform/monitoring.tf`, following its established patterns. Everything is GCP-native Cloud Monitoring/Logging; alerts reuse the existing email channel `google_monitoring_notification_channel.email`. One `terraform apply` at the end.

**Tech Stack:** Terraform (hashicorp/google ~6.50), GCP Cloud Monitoring, Cloud Logging.

**Spec:** `docs/superpowers/specs/2026-07-06-monitoring-expansion-design.md`

**Context for the implementer:**
- Working dir for all terraform commands: `H:\TRYOUT\infra\terraform` (Git Bash: `/h/TRYOUT/infra/terraform`).
- Terraform state is local (`terraform.tfstate` in that dir). Provider already initialized (`.terraform/` present). If `terraform validate` complains about init, run `terraform init` once.
- Cloud Run service URIs come from `google_cloud_run_v2_service.api.uri` / `.web.uri` (defined in `cloudrun.tf`) — full `https://...` URLs; uptime checks need the bare host, hence `trimprefix(..., "https://")`.
- There is no unit-test framework for Terraform here. Verification per task = `terraform validate` + `terraform plan` with expected resource counts. TDD does not apply; do NOT invent test scaffolding.
- Windows machine: `gcloud.cmd`, not `gcloud`.

---

### Task 1: Uptime checks + uptime alert

**Files:**
- Modify: `infra/terraform/monitoring.tf` (append at end of file, after `google_monitoring_alert_policy.api_5xx`)

- [ ] **Step 1: Append the two uptime checks and the alert policy**

Append this exact block to the end of `infra/terraform/monitoring.tf`:

```hcl
# Uptime checks — /health on the API runs SELECT 1 against Postgres, so one
# probe covers API liveness + DB reachability. Web / just proves the frontend
# is serving.
resource "google_monitoring_uptime_check_config" "api_health" {
  display_name = "tryout-api /health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/health"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.api.uri, "https://")
    }
  }
}

resource "google_monitoring_uptime_check_config" "web_home" {
  display_name = "tryout-web /"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path         = "/"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = trimprefix(google_cloud_run_v2_service.web.uri, "https://")
    }
  }
}

# Fires when either uptime check fails. REDUCE_COUNT_FALSE counts checkers
# reporting failure; 120s duration absorbs a single network blip.
resource "google_monitoring_alert_policy" "uptime_failure" {
  display_name = "Uptime check failure"
  combiner     = "OR"

  conditions {
    display_name = "tryout-api /health failing"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.api_health.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
      trigger { count = 1 }
    }
  }

  conditions {
    display_name = "tryout-web / failing"
    condition_threshold {
      filter          = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.labels.check_id=\"${google_monitoring_uptime_check_config.web_home.uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "120s"
      aggregations {
        alignment_period     = "1200s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
      trigger { count = 1 }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  alert_strategy {
    auto_close = "1800s"
  }
}
```

- [ ] **Step 2: Validate**

Run (in `infra/terraform`): `terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Plan**

Run: `terraform plan`
Expected: `Plan: 3 to add, 0 to change, 0 to destroy.` — the 3 adds are `google_monitoring_uptime_check_config.api_health`, `google_monitoring_uptime_check_config.web_home`, `google_monitoring_alert_policy.uptime_failure`. If unrelated drift shows as "change", note it but proceed (do not apply yet).

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/monitoring.tf
git commit -m "feat(infra): uptime checks for api /health and web / with failure alert"
```

---

### Task 2: Cause-specific log alerts

**Files:**
- Modify: `infra/terraform/monitoring.tf` (append at end)

- [ ] **Step 1: Append two log metrics + two alert policies**

Append this exact block to the end of `infra/terraform/monitoring.tf`:

```hcl
# Cause-specific log alerts — matched to real incidents (2026-07-06) so the
# email names the actual cause instead of a generic "errors spiked". Substring
# match (:) on textPayload; no severity clause because multi-line stderr
# entries don't always carry ERROR severity on the matching line.
resource "google_logging_metric" "disk_full_errors" {
  name   = "tryout_disk_full_errors"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"tryout-api\" AND textPayload:\"No space left on device\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_logging_metric" "llm_auth_errors" {
  name   = "tryout_llm_auth_errors"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"tryout-api\" AND textPayload:\"invalid_api_key\""
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "disk_full" {
  display_name = "Postgres disk full (write failures)"
  combiner     = "OR"

  conditions {
    display_name = "\"No space left on device\" seen in tryout-api logs"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.disk_full_errors.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  alert_strategy {
    auto_close = "1800s"
  }
}

resource "google_monitoring_alert_policy" "llm_auth" {
  display_name = "LLM auth failure (invalid_api_key)"
  combiner     = "OR"

  conditions {
    display_name = "\"invalid_api_key\" seen in tryout-api logs"
    condition_threshold {
      filter          = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.llm_auth_errors.name}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
      trigger { count = 1 }
    }
  }

  notification_channels = [google_monitoring_notification_channel.email.id]
  alert_strategy {
    auto_close = "1800s"
  }
}
```

- [ ] **Step 2: Validate**

Run: `terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Plan**

Run: `terraform plan`
Expected: `Plan: 7 to add, 0 to change, 0 to destroy.` (3 from Task 1 still unapplied + 2 log metrics + 2 alert policies).

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/monitoring.tf
git commit -m "feat(infra): cause-specific log alerts for disk-full and LLM auth failures"
```

---

### Task 3: Ops dashboard

**Files:**
- Modify: `infra/terraform/monitoring.tf` (append at end)

- [ ] **Step 1: Append the dashboard resource**

Append this exact block to the end of `infra/terraform/monitoring.tf`:

```hcl
# One ops dashboard: traffic, latency, 5xx, disk, uptime, error-log rate.
resource "google_monitoring_dashboard" "ops" {
  dashboard_json = jsonencode({
    displayName = "Tryout Ops"
    mosaicLayout = {
      columns = 12
      tiles = [
        {
          xPos = 0, yPos = 0, width = 6, height = 4
          widget = {
            title = "Request count (api + web)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 0, width = 6, height = 4
          widget = {
            title = "API request latency p95 (ms)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"tryout-api\" AND metric.type=\"run.googleapis.com/request_latencies\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_PERCENTILE_95"
                      crossSeriesReducer = "REDUCE_MEAN"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 4, width = 6, height = 4
          widget = {
            title = "5xx rate (api + web)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"run.googleapis.com/request_count\" AND metric.labels.response_code_class=\"5xx\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_RATE"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.service_name"]
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 4, width = 6, height = 4
          widget = {
            title = "Postgres VM disk % used"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"gce_instance\" AND metric.type=\"agent.googleapis.com/disk/percent_used\" AND metric.labels.state=\"used\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_MAX"
                      groupByFields      = ["resource.label.instance_id"]
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 0, yPos = 8, width = 6, height = 4
          widget = {
            title = "Uptime check pass"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"uptime_url\" AND metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\""
                    aggregation = {
                      alignmentPeriod    = "300s"
                      perSeriesAligner   = "ALIGN_FRACTION_TRUE"
                      crossSeriesReducer = "REDUCE_MIN"
                      groupByFields      = ["resource.label.host"]
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        },
        {
          xPos = 6, yPos = 8, width = 6, height = 4
          widget = {
            title = "API error-log rate"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "resource.type=\"cloud_run_revision\" AND metric.type=\"logging.googleapis.com/user/${google_logging_metric.api_errors.name}\""
                    aggregation = {
                      alignmentPeriod    = "60s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
            }
          }
        }
      ]
    }
  })
}
```

- [ ] **Step 2: Validate**

Run: `terraform validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Plan**

Run: `terraform plan`
Expected: `Plan: 8 to add, 0 to change, 0 to destroy.` (7 from Tasks 1-2 + 1 dashboard).

- [ ] **Step 4: Commit**

```bash
git add infra/terraform/monitoring.tf
git commit -m "feat(infra): Tryout Ops dashboard (traffic, latency, 5xx, disk, uptime, errors)"
```

---

### Task 4: Apply + verify

**Files:** none (operations only)

- [ ] **Step 1: Apply**

Run (in `infra/terraform`): `terraform apply -auto-approve`
Expected: `Apply complete! Resources: 8 added, 0 changed, 0 destroyed.` If GCP rejects the dashboard JSON or an alert filter, fix the resource inline, re-validate, re-apply, and amend the relevant commit message understanding in the final report.

- [ ] **Step 2: Verify uptime checks exist and start passing**

Run: `gcloud.cmd monitoring uptime list-configs --project tryout-sre-lab-260703 --format="table(displayName,period)"`
Expected: both `tryout-api /health` and `tryout-web /` listed. Checks take 1-5 min for first results.

Then verify targets respond (checks will pass only if these return 200):

```bash
curl -s -o /dev/null -w "%{http_code}" https://tryout-api-t7ysqi4xoq-uc.a.run.app/health
curl -s -o /dev/null -w "%{http_code}" https://tryout-web-t7ysqi4xoq-uc.a.run.app/
```

Expected: `200` from both.

- [ ] **Step 3: Verify dashboard renders**

Run: `gcloud.cmd monitoring dashboards list --project tryout-sre-lab-260703 --format="table(displayName)"`
Expected: `Tryout Ops` listed. Visual tile check happens in the Cloud Console (report the URL `https://console.cloud.google.com/monitoring/dashboards?project=tryout-sre-lab-260703` for the user to eyeball).

- [ ] **Step 4: Verify alert policies**

Run: `gcloud.cmd alpha monitoring policies list --project tryout-sre-lab-260703 --format="table(displayName,enabled)"`
Expected: 6 policies total — the 3 pre-existing (`API error-log spike`, `Postgres VM disk > 85%`, `API 5xx spike`) plus the 3 new (`Uptime check failure`, `Postgres disk full (write failures)`, `LLM auth failure (invalid_api_key)`), all enabled.

- [ ] **Step 5: Commit any fixups**

Only if Step 1 required inline fixes:

```bash
git add infra/terraform/monitoring.tf
git commit -m "fix(infra): adjust monitoring resources per apply feedback"
```
