# Custom VPC = default-deny ingress. These are the only ways in.

# Postgres reachable only from the subnet + the Cloud Run VPC connector.
resource "google_compute_firewall" "postgres" {
  name      = "tryout-allow-postgres"
  network   = google_compute_network.vpc.name
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
  source_ranges = [google_compute_subnetwork.subnet.ip_cidr_range, "10.8.0.0/28"]
}

# IAP-authenticated Postgres access for admin/ops (migrations, psql) without a
# public DB. Requires a matching pg_hba entry for this range on the VM.
resource "google_compute_firewall" "iap_postgres" {
  name      = "tryout-allow-iap-postgres"
  network   = google_compute_network.vpc.name
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["5432"]
  }
  source_ranges = ["35.235.240.0/20"] # Google IAP range
}

# SSH via Identity-Aware Proxy only (no public SSH). Lets you get on the box to
# practice incidents without exposing 22 to the internet.
resource "google_compute_firewall" "iap_ssh" {
  name      = "tryout-allow-iap-ssh"
  network   = google_compute_network.vpc.name
  direction = "INGRESS"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
  source_ranges = ["35.235.240.0/20"] # Google IAP range
}
