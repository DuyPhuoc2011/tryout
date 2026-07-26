locals {
  # Every resource carries this, so a cost report and an orphan sweep are both
  # one label filter away.
  labels = {
    arena_env = var.environment_id
    managed   = "arena-runner"
  }

  # db_tier is a saturation lever, not a machine size: all environments share
  # one Postgres VM, and the tier caps how many connections the environment's
  # role may hold. A design that scales the API out past its connection budget
  # is supposed to fail here — that is the lesson.
  #
  # ponytail: first-cut numbers, not measured. M1-B3 tunes them against the M0
  # traffic profile the same way par.ts gets its real values.
  db_connection_limits = {
    micro  = 20
    small  = 60
    medium = 150
  }

  db_name = replace(var.environment_id, "-", "_")

  database_url = "postgres://${postgresql_role.env.name}:${random_password.db.result}@${var.db_host}:5432/${postgresql_database.env.name}"

  # The cache is a sidecar on the API instance, so it is always at localhost.
  redis_url = var.cache_enabled ? "redis://127.0.0.1:6379" : ""
}

# ---------------------------------------------------------------------------
# Database: one database + one role on the shared arena Postgres VM.
#
# Managed by the postgresql provider rather than an out-of-band SQL script so
# that `terraform destroy` reclaims the database. A reaper that has to remember
# a second cleanup path is a reaper that eventually leaks one.
# ---------------------------------------------------------------------------

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "postgresql_role" "env" {
  name             = local.db_name
  login            = true
  password         = random_password.db.result
  connection_limit = local.db_connection_limits[var.db_tier]
}

resource "postgresql_database" "env" {
  name  = local.db_name
  owner = postgresql_role.env.name
}

# ---------------------------------------------------------------------------
# API service — the primary lever. Buyer-chosen scaling, concurrency, CPU, and
# memory land here directly.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "api" {
  name     = "${var.environment_id}-api"
  location = var.region
  labels   = local.labels

  # Internal only: load comes from the in-VPC harness (M1-B3), and a buyer
  # environment has no reason to be reachable from the internet.
  ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  deletion_protection = false

  template {
    service_account = var.runtime_service_account
    labels          = local.labels

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }

    max_instance_request_concurrency = var.api_concurrency

    vpc_access {
      connector = var.vpc_connector
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      name  = "app"
      image = var.scenario_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = tostring(var.api_cpu)
          memory = var.api_memory
        }
      }

      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }
      env {
        name  = "REDIS_URL"
        value = local.redis_url
      }
      # Workers run inside this service unless the buyer split them out.
      env {
        name  = "WORKERS_IN_PROCESS"
        value = var.worker_service_enabled ? "false" : "true"
      }

      # Sidecar startup ordering: the app container must not be probed before
      # the cache it will connect to is up.
      depends_on = var.cache_enabled ? ["cache"] : []
    }

    # ponytail: the cache is a Cloud Run SIDECAR, not Memorystore.
    #
    # Ceiling, stated so M1-B3 does not rediscover it: this cache is
    # per-instance (no sharing across instances, cold on every scale-out) and
    # has no HA, so `standard-1gb` builds exactly what `basic-1gb` builds and
    # the two tiers differ only in the price rates.ts charges for them.
    #
    # Upgrade path: promote to google_redis_instance (BASIC/STANDARD_HA) when a
    # chaos drill actually needs a failover, or when cross-instance hit rate
    # becomes part of the score. That costs ~$40/env/month and ~6 min of apply
    # time per turn, which is why it is not the default at 25 live environments.
    #
    # A Cloud Run *service* is not an option for Redis at all: Cloud Run serves
    # HTTP/1, HTTP/2 and gRPC only, and RESP is none of those.
    dynamic "containers" {
      for_each = var.cache_enabled ? [1] : []
      content {
        name  = "cache"
        image = "redis:7-alpine"

        resources {
          limits = {
            cpu    = "1"
            memory = "1Gi"
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }
}

# ---------------------------------------------------------------------------
# Worker service — exists only when the buyer chose separate_service placement.
# ---------------------------------------------------------------------------

resource "google_cloud_run_v2_service" "worker" {
  count = var.worker_service_enabled ? 1 : 0

  name     = "${var.environment_id}-worker"
  location = var.region
  labels   = local.labels

  ingress             = "INGRESS_TRAFFIC_INTERNAL_ONLY"
  deletion_protection = false

  template {
    service_account = var.runtime_service_account
    labels          = local.labels

    scaling {
      min_instance_count = var.worker_min_instances
      max_instance_count = var.worker_max_instances
    }

    vpc_access {
      connector = var.vpc_connector
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      name  = "worker"
      image = var.scenario_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = tostring(var.api_cpu)
          memory = var.api_memory
        }
      }

      env {
        name  = "DATABASE_URL"
        value = local.database_url
      }
      env {
        name  = "WORKERS_IN_PROCESS"
        value = "true"
      }
      env {
        name  = "WORKER_ONLY"
        value = "true"
      }
    }
  }

  lifecycle {
    ignore_changes = [client, client_version]
  }
}
