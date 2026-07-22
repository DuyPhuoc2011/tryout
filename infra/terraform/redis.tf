resource "google_redis_instance" "cache" {
  name           = "tryout-redis"
  tier           = "BASIC"
  memory_size_gb = var.redis_memory_gb
  region         = var.region

  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"
  redis_version      = "REDIS_7_0"

  depends_on = [google_service_networking_connection.private_services]

  # ponytail: no AUTH / no TLS. It's only reachable inside the VPC. Turn on
  # auth_enabled + transit_encryption_mode if this ever leaves the sandbox.
}
