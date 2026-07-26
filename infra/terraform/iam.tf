# One runtime identity per service, least privilege.
resource "google_service_account" "api" {
  account_id   = "tryout-api"
  display_name = "Tryout API (Cloud Run runtime)"
}

resource "google_service_account" "web" {
  account_id   = "tryout-web"
  display_name = "Tryout Web (Cloud Run runtime)"
}

# Postgres VM identity — lets the Ops Agent ship host metrics + logs.
resource "google_service_account" "postgres_vm" {
  account_id   = "tryout-postgres-vm"
  display_name = "Tryout Postgres VM (Ops Agent)"
}

resource "google_project_iam_member" "vm_metrics" {
  project = var.project_id
  role    = "roles/monitoring.metricWriter"
  member  = "serviceAccount:${google_service_account.postgres_vm.email}"
}

resource "google_project_iam_member" "vm_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.postgres_vm.email}"
}

# Only the API reads secrets. Grant accessor per-secret rather than project-wide.
resource "google_secret_manager_secret_iam_member" "api_access" {
  for_each  = google_secret_manager_secret.app
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
