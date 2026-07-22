output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Public URL of the API service."
}

output "web_url" {
  value       = google_cloud_run_v2_service.web.uri
  description = "Public URL of the web service."
}

output "registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  description = "Artifact Registry path to push images to."
}

output "db_private_ip" {
  value       = google_compute_address.postgres.address
  description = "Postgres VM internal IP (reachable only from inside the VPC)."
}

output "redis_host" {
  value       = google_redis_instance.cache.host
  description = "Memorystore private host."
}
