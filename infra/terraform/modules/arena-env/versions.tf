terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.22"
    }
  }

  # Partial backend config. The runner supplies the per-environment prefix:
  #   terraform init -backend-config=bucket=... -backend-config=prefix=arena/<env_slug>
  # One state file per environment, so a runner working on one environment has
  # no path to another's state that does not start with choosing a different
  # prefix — and the prefix comes from the database row it claimed.
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# Connects to the shared Postgres VM over its private IP, which the runner
# reaches through the same VPC connector the API uses.
provider "postgresql" {
  host      = var.db_host
  port      = 5432
  username  = var.db_admin_user
  password  = var.db_admin_password
  sslmode   = "disable"
  superuser = false
}
