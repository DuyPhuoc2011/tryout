# ---------------------------------------------------------------------------
# Arena runner infrastructure (M1-B2).
#
# Everything a buyer environment is BUILT BY lives here. What a buyer
# environment IS lives in infra/terraform/arena-env/, applied per environment
# by the runner with its own state prefix.
# ---------------------------------------------------------------------------

# One state file per environment, under arena/<env_slug>/.
resource "google_storage_bucket" "arena_state" {
  name                        = "${var.project_id}-arena-state"
  location                    = var.region
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  # State history is worth keeping while an apply might need unwinding, and
  # worthless a month later.
  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }
}

# The runner's identity. Holds the only credentials in this project that can
# create billable infrastructure on demand.
resource "google_service_account" "arena_runner" {
  account_id   = "arena-runner"
  display_name = "Arena runner (applies buyer environments)"
}

# The identity every buyer environment RUNS as. Deliberately has no role
# bindings anywhere in this project: a buyer's code can call no Google API.
# If you are about to grant this something, that is the security boundary you
# are dissolving.
resource "google_service_account" "arena_env_runtime" {
  account_id   = "arena-env-runtime"
  display_name = "Arena buyer environment runtime (no permissions, by design)"
}

# Create/delete Cloud Run services for buyer environments.
#
# ponytail: run.admin is project-wide here. A condition restricting it to
# resources named env-* is the tightening, and IAM conditions do support
# resource.name prefix matching on Cloud Run. Left open until the runner has
# actually applied once, because a half-right condition fails at apply time
# with a permission error that looks identical to a dozen other causes.
resource "google_project_iam_member" "arena_runner_run_admin" {
  project = var.project_id
  role    = "roles/run.admin"
  member  = "serviceAccount:${google_service_account.arena_runner.email}"
}

# Required to deploy a service that runs AS arena_env_runtime. Granted on that
# one service account, not project-wide, so the runner cannot impersonate the
# API's identity (which does hold secret access).
resource "google_service_account_iam_member" "arena_runner_acts_as_runtime" {
  service_account_id = google_service_account.arena_env_runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.arena_runner.email}"
}

# State access, scoped to the arena bucket only.
resource "google_storage_bucket_iam_member" "arena_runner_state" {
  bucket = google_storage_bucket.arena_state.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.arena_runner.email}"
}

# The Postgres admin credential the runner's postgresql provider uses to create
# each environment's database and role.
resource "random_password" "arena_db_admin" {
  length  = 32
  special = false
}

resource "google_secret_manager_secret" "arena" {
  for_each  = local.arena_secrets
  secret_id = each.key
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "arena" {
  for_each    = local.arena_secrets
  secret      = google_secret_manager_secret.arena[each.key].id
  secret_data = each.value
}

resource "google_secret_manager_secret_iam_member" "arena_runner_access" {
  for_each  = google_secret_manager_secret.arena
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.arena_runner.email}"
}

locals {
  arena_secrets = {
    # The runner reads and writes arena_turns / arena_environments directly.
    "arena-database-url"      = local.database_url
    "arena-db-admin-password" = random_password.arena_db_admin.result
  }
}

# ---------------------------------------------------------------------------
# The runner job. Two modes, one image, one schedule each.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_job" "arena_runner" {
  name     = "arena-runner"
  location = var.region

  deletion_protection = false

  template {
    template {
      service_account = google_service_account.arena_runner.email
      # An apply is minutes long; a stuck one must not bill for an hour.
      timeout     = "900s"
      max_retries = 0

      vpc_access {
        connector = google_vpc_access_connector.connector.id
        egress    = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image = local.placeholder_image
        args  = ["--mode=apply"]

        env {
          name  = "ARENA_STATE_BUCKET"
          value = google_storage_bucket.arena_state.name
        }
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = var.project_id
        }
        env {
          name  = "ARENA_REGION"
          value = var.region
        }
        env {
          name  = "ARENA_VPC_CONNECTOR"
          value = google_vpc_access_connector.connector.id
        }
        env {
          name  = "ARENA_RUNTIME_SERVICE_ACCOUNT"
          value = google_service_account.arena_env_runtime.email
        }
        env {
          name  = "ARENA_SCENARIO_IMAGE"
          value = var.arena_scenario_image
        }
        env {
          name  = "ARENA_DB_HOST"
          value = google_compute_address.postgres.address
        }
        env {
          name  = "ARENA_DB_ADMIN_USER"
          value = "arena_admin"
        }
        dynamic "env" {
          for_each = {
            DATABASE_URL            = "arena-database-url"
            ARENA_DB_ADMIN_PASSWORD = "arena-db-admin-password"
          }
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = google_secret_manager_secret.arena[env.value].secret_id
                version = "latest"
              }
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }
}

# Scheduler triggers the job over the Cloud Run Admin API. The runner SA is
# reused as the caller identity: a second SA whose only power is "start this
# one job" adds a resource without adding a boundary, since the job it starts
# already runs as the runner.
resource "google_cloud_run_v2_job_iam_member" "arena_runner_invoker" {
  name     = google_cloud_run_v2_job.arena_runner.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.arena_runner.email}"
}

locals {
  arena_runner_run_url = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.arena_runner.name}:run"
}

# Apply: one claimed turn per tick. MAX_TURNS_PER_HOUR is 6 per environment, so
# a 60s tick is far faster than the queue can legally fill.
resource "google_cloud_scheduler_job" "arena_apply" {
  name             = "arena-apply"
  schedule         = "* * * * *"
  region           = var.region
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = local.arena_runner_run_url
    # Mode is the container default (--mode=apply); no override needed.
    oauth_token {
      service_account_email = google_service_account.arena_runner.email
    }
  }
}

# Reap: destroy environments past their TTL. Quarter-hourly is well inside the
# 72h TTL and keeps destroy churn off the apply path.
resource "google_cloud_scheduler_job" "arena_reap" {
  name             = "arena-reap"
  schedule         = "*/15 * * * *"
  region           = var.region
  attempt_deadline = "60s"

  http_target {
    http_method = "POST"
    uri         = local.arena_runner_run_url
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{
          args = ["--mode=reap"]
        }]
      }
    }))
    headers = {
      "Content-Type" = "application/json"
    }
    oauth_token {
      service_account_email = google_service_account.arena_runner.email
    }
  }
}
