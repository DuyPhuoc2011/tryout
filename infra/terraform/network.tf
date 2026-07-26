# Dedicated VPC so Cloud Run can reach Cloud SQL + Memorystore over private IP.
resource "google_compute_network" "vpc" {
  name                    = "tryout-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "tryout-subnet"
  ip_cidr_range = "10.10.0.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

# Reserved range Google's managed services (Cloud SQL, Memorystore) allocate
# private IPs from, wired up via private services access (VPC peering).
resource "google_compute_global_address" "private_services" {
  name          = "tryout-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
}

# Serverless VPC Access connector: the bridge Cloud Run uses to send traffic
# into the VPC (and thus to the private-IP database + redis).
resource "google_vpc_access_connector" "connector" {
  name          = "tryout-connector"
  region        = var.region
  ip_cidr_range = "10.8.0.0/28"
  network       = google_compute_network.vpc.name
  min_instances = 2
  max_instances = 3
}
