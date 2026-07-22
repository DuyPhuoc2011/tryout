# Docker images for both services live here; Cloud Run pulls from it.
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "tryout"
  format        = "DOCKER"
  description   = "Tryout API + web container images"
}
