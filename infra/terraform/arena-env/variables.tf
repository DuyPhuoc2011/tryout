# ---------------------------------------------------------------------------
# Buyer-selected variables.
#
# These twelve are exactly the fields of `ArenaTfvars` in @tryout/arena, and
# they are the ONLY values a buyer influences. Each carries a validation block
# mirroring `designSchema`/`arenaTfvarsSchema`: the runner validates before it
# gets here, but this config must be safe when applied by hand too, and a
# bound that lives in one language only is a bound that drifts.
#
# Nothing here can express an image, a command, a provisioner, or a provider.
# ---------------------------------------------------------------------------

variable "environment_id" {
  type        = string
  description = "Buyer environment slug. Becomes the name prefix of every resource."

  validation {
    # Same pattern as renderTfvars and the arena_env_slug_shape CHECK constraint.
    condition     = can(regex("^env-[a-z0-9]{6,32}$", var.environment_id))
    error_message = "environment_id must match ^env-[a-z0-9]{6,32}$."
  }
}

variable "api_min_instances" {
  type = number
  validation {
    condition     = var.api_min_instances == floor(var.api_min_instances) && var.api_min_instances >= 0 && var.api_min_instances <= 5
    error_message = "api_min_instances must be an integer in [0, 5]."
  }
}

variable "api_max_instances" {
  type = number
  validation {
    condition     = var.api_max_instances == floor(var.api_max_instances) && var.api_max_instances >= 1 && var.api_max_instances <= 20
    error_message = "api_max_instances must be an integer in [1, 20]."
  }
}

variable "api_concurrency" {
  type = number
  validation {
    condition     = var.api_concurrency == floor(var.api_concurrency) && var.api_concurrency >= 1 && var.api_concurrency <= 250
    error_message = "api_concurrency must be an integer in [1, 250]."
  }
}

variable "api_cpu" {
  type = number
  validation {
    condition     = contains([0.5, 1, 2], var.api_cpu)
    error_message = "api_cpu must be one of 0.5, 1, 2."
  }
}

variable "api_memory" {
  type = string
  validation {
    condition     = contains(["512Mi", "1Gi", "2Gi"], var.api_memory)
    error_message = "api_memory must be one of 512Mi, 1Gi, 2Gi."
  }
}

variable "worker_service_enabled" {
  type = bool
}

variable "worker_min_instances" {
  type = number
  validation {
    condition     = var.worker_min_instances == floor(var.worker_min_instances) && var.worker_min_instances >= 0 && var.worker_min_instances <= 3
    error_message = "worker_min_instances must be an integer in [0, 3]."
  }
}

variable "worker_max_instances" {
  type = number
  validation {
    condition     = var.worker_max_instances == floor(var.worker_max_instances) && var.worker_max_instances >= 1 && var.worker_max_instances <= 20
    error_message = "worker_max_instances must be an integer in [1, 20]."
  }
}

variable "cache_enabled" {
  type = bool
}

variable "cache_tier" {
  type = string
  validation {
    condition     = contains(["basic-1gb", "standard-1gb"], var.cache_tier)
    error_message = "cache_tier must be one of basic-1gb, standard-1gb."
  }
}

variable "db_tier" {
  type = string
  validation {
    condition     = contains(["micro", "small", "medium"], var.db_tier)
    error_message = "db_tier must be one of micro, small, medium."
  }
}

# ---------------------------------------------------------------------------
# Platform wiring. Supplied by the runner from its own environment, never by a
# buyer. Kept as variables rather than data sources so this config can be
# applied against a scratch project without reading the production state.
# ---------------------------------------------------------------------------

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "vpc_connector" {
  type        = string
  description = "Serverless VPC Access connector id, for private egress to the Postgres VM."
}

variable "runtime_service_account" {
  type        = string
  description = "Email of the powerless SA every buyer service runs as. It holds no role bindings by design."
}

variable "scenario_image" {
  type        = string
  description = "Container image of the scenario application under test. Chosen by us per scenario, never by the buyer."
}

variable "db_host" {
  type        = string
  description = "Private IP of the shared arena Postgres VM."
}

variable "db_admin_user" {
  type = string
}

variable "db_admin_password" {
  type      = string
  sensitive = true
}
