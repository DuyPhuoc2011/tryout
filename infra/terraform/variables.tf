variable "project_id" {
  type        = string
  description = "GCP project id to deploy into."
}

variable "region" {
  type        = string
  description = "GCP region for all regional resources."
  default     = "us-central1"
}

variable "zone" {
  type        = string
  description = "Zone for the Postgres VM."
  default     = "us-central1-a"
}

variable "db_machine_type" {
  type        = string
  description = "Postgres VM machine type. e2-micro fits the GCP free tier."
  default     = "e2-micro"
}

variable "redis_memory_gb" {
  type        = number
  description = "Memorystore capacity in GB (basic tier)."
  default     = 1
}

variable "github_owner" {
  type        = string
  description = "GitHub org/user that owns candidate repos + the template."
}

variable "github_token" {
  type        = string
  sensitive   = true
  description = "GitHub PAT for the API. Set via TF_VAR_github_token or terraform.tfvars (gitignored)."
}

variable "openai_api_key" {
  type        = string
  sensitive   = true
  description = "OpenAI API key for the agents. Set via TF_VAR_openai_api_key or terraform.tfvars."
}

variable "openai_base_url" {
  type        = string
  description = "OpenAI-compatible base URL. api.openai.com for real OpenAI."
  default     = "https://api.openai.com/v1"
}

variable "llm_chat_model" {
  type        = string
  description = "Model for cheap chat calls (PM intro, conversation)."
  default     = "gpt-4o-mini"
}

variable "llm_review_model" {
  type        = string
  description = "Model for heavier review/grade calls."
  default     = "gpt-4o"
}

variable "alert_email" {
  type        = string
  description = "Where alert notifications go."
  default     = "duyphuoc23122012@gmail.com"
}

variable "github_template_repo" {
  type        = string
  description = "Template repo candidates are cloned from."
  default     = "lumi-tasks-api"
}

variable "stripe_secret_key" {
  type        = string
  sensitive   = true
  description = "Stripe API key (test mode until launch). Set via TF_VAR_stripe_secret_key or terraform.tfvars."
}

variable "stripe_webhook_secret" {
  type        = string
  sensitive   = true
  description = "Stripe webhook endpoint signing secret. Set via TF_VAR_stripe_webhook_secret or terraform.tfvars."
}

variable "web_base_url" {
  type        = string
  description = "Public URL of the web service, used for Stripe success/cancel redirects. Not derived from the web Cloud Run resource to avoid an api<->web dependency cycle."
}
