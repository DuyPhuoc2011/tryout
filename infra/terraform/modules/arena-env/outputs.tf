output "api_uri" {
  description = "Internal URI of the buyer's API service. The load harness (M1-B3) targets this."
  value       = google_cloud_run_v2_service.api.uri
}

output "worker_service_name" {
  description = "Name of the split worker service, or null when workers run in-process."
  value       = var.worker_service_enabled ? google_cloud_run_v2_service.worker[0].name : null
}

output "database_name" {
  value = postgresql_database.env.name
}
