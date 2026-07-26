resource "random_password" "jwt" {
  length  = 48
  special = false
}

locals {
  database_url = "postgres://tryout:${random_password.db.result}@${google_compute_address.postgres.address}:5432/tryout"
  redis_url    = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"

  secrets = {
    "database-url"          = local.database_url
    "jwt-secret"            = random_password.jwt.result
    "github-token"          = var.github_token
    "openai-api-key"        = var.openai_api_key
    "stripe-secret-key"     = var.stripe_secret_key
    "stripe-webhook-secret" = var.stripe_webhook_secret
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  secret_id = each.key
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = local.secrets
  secret      = google_secret_manager_secret.app[each.key].id
  secret_data = each.value
}
