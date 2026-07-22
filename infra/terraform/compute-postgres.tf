resource "random_password" "db" {
  length  = 24
  special = false
}

# Stable internal IP so DATABASE_URL survives VM recreation.
resource "google_compute_address" "postgres" {
  name         = "tryout-postgres-ip"
  subnetwork   = google_compute_subnetwork.subnet.id
  address_type = "INTERNAL"
  region       = var.region
}

# ponytail: self-hosted Postgres on one e2-micro. No HA, no managed backups,
# no autoscaling — that's the point (cheap + lots to operate). Graduate to
# Cloud SQL when traffic justifies it; DATABASE_URL is the only thing to swap.
resource "google_compute_instance" "postgres" {
  name         = "tryout-postgres"
  machine_type = var.db_machine_type
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
      size  = 30 # GB, pd-standard free-tier ceiling
      type  = "pd-standard"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.subnet.id
    network_ip = google_compute_address.postgres.address
    # Ephemeral external IP for outbound package installs only. Ingress is
    # default-deny on this VPC; see firewall.tf for the one 5432 allow.
    access_config {}
  }

  service_account {
    email  = google_service_account.postgres_vm.email
    scopes = ["cloud-platform"]
  }

  metadata = {
    # ponytail: password via metadata (readable by anyone who can describe the
    # instance). Fine for a private sandbox. Upgrade path: give the VM a service
    # account + secretAccessor and pull it from Secret Manager in the script.
    startup-script = templatefile("${path.module}/scripts/postgres-startup.sh.tpl", {
      db_password   = random_password.db.result
      subnet_cidr   = google_compute_subnetwork.subnet.ip_cidr_range
      vpc_conn_cidr = "10.8.0.0/28"
    })
  }

  allow_stopping_for_update = true
}
