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
  }

  # ponytail: local state for the sandbox. Move to a GCS backend
  # (terraform { backend "gcs" {...} }) when more than one person/machine
  # touches this, or when you want state locking + history.
}

provider "google" {
  project = var.project_id
  region  = var.region
}
