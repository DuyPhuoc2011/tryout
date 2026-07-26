# Placeholder image so the service can be created before the first real build.
# Real image versions are pushed by CD (gcloud run deploy / CI), and the
# lifecycle ignore_changes below stops Terraform from reverting them.
locals {
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "tryout-api"
  location = var.region

  deletion_protection = false

  template {
    service_account = google_service_account.api.email

    # min=1 keeps the in-process BullMQ workers alive so async work runs without
    # traffic. Set to 0 to drill F09 (scale-to-zero starves the workers).
    scaling {
      min_instance_count = 1
      max_instance_count = 4
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = local.placeholder_image

      # Cloud Run injects PORT and expects the app to listen on it; the NestJS
      # app already reads env.PORT, so we don't set it here.
      env {
        name  = "REDIS_URL"
        value = local.redis_url
      }
      env {
        name  = "GITHUB_OWNER"
        value = var.github_owner
      }
      env {
        name  = "GITHUB_TEMPLATE_REPO"
        value = var.github_template_repo
      }
      env {
        name  = "LLM_PROVIDER"
        value = "openai"
      }
      env {
        name  = "OPENAI_BASE_URL"
        value = var.openai_base_url
      }
      env {
        name  = "LLM_CHAT_MODEL"
        value = var.llm_chat_model
      }
      env {
        name  = "LLM_REVIEW_MODEL"
        value = var.llm_review_model
      }
      # Stripe redirect base. A var (not web.uri) because web already depends
      # on api.uri — referencing it here would create a dependency cycle.
      env {
        name  = "WEB_BASE_URL"
        value = var.web_base_url
      }
      dynamic "env" {
        for_each = {
          DATABASE_URL          = "database-url"
          JWT_SECRET            = "jwt-secret"
          GITHUB_TOKEN          = "github-token"
          OPENAI_API_KEY        = "openai-api-key"
          STRIPE_SECRET_KEY     = "stripe-secret-key"
          STRIPE_WEBHOOK_SECRET = "stripe-webhook-secret"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

resource "google_cloud_run_v2_service" "web" {
  name     = "tryout-web"
  location = var.region

  deletion_protection = false

  template {
    service_account = google_service_account.web.email

    containers {
      image = local.placeholder_image

      # ponytail: Next.js bakes NEXT_PUBLIC_* at BUILD time, so this runtime
      # value only helps server components. The client bundle needs it passed
      # as a --build-arg when CI builds the web image. Documented in README.
      env {
        name  = "NEXT_PUBLIC_API_URL"
        value = google_cloud_run_v2_service.api.uri
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
}

# Public: both services are internet-facing.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
