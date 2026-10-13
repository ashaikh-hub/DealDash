# A "cell" = one complete DealDash deployment (API + 5 web apps + database + storage + secrets + logs) in ONE region.
# The same module builds staging (Doha), a Pakistan pilot cell, or the KSA (Dammam) cell — only the variables differ.

variable "project_id" {
  type        = string
  description = "Google Cloud project for this cell (one project per environment / cell)."
}

variable "region" {
  type        = string
  description = "Region for every regional resource (data residency). Staging: me-central1 (Doha)."
}

variable "environment" {
  type        = string
  description = "APP_ENV of this cell: staging or production."
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "name_prefix" {
  type        = string
  default     = "dd"
  description = "Short prefix for resource names."
}

# ---------------------------------------------------------------- database
variable "db_version" {
  type        = string
  default     = "POSTGRES_18"
  description = "Cloud SQL major version. The app is tested on PostgreSQL 18; if the region does not offer it, use POSTGRES_17 only after the compatibility test."
}

variable "db_tier" {
  type        = string
  default     = "db-g1-small"
  description = "Cloud SQL machine tier (staging: shared core; production: dedicated, e.g. db-custom-2-7680)."
}

variable "db_high_availability" {
  type        = bool
  default     = false
  description = "Regional (multi-zone) HA. Staging false (budget); production true."
}

variable "db_pitr_days" {
  type        = number
  default     = 7
  description = "Point-in-time-recovery log retention in days (founder production target: 14)."
}

variable "db_deletion_protection" {
  type    = bool
  default = true
}

# ---------------------------------------------------------------- images and scaling
variable "images" {
  type        = map(string)
  description = "Container image per service: api, migrate, customer, merchant, staff, partner, admin (Artifact Registry, tagged by release)."
}

variable "api_min_instances" {
  type        = number
  default     = 1
  description = "At least 1: scheduled jobs run inside the API process (CPU always allocated)."
}

variable "api_max_instances" {
  type    = number
  default = 3
}

variable "web_min_instances" {
  type        = number
  default     = 0
  description = "Staging may scale web apps to zero (cold starts acceptable); production >= 1."
}

variable "web_max_instances" {
  type    = number
  default = 2
}

# ---------------------------------------------------------------- application settings (non-secret)
variable "app_env" {
  type        = map(string)
  default     = {}
  description = "Extra non-secret environment variables for the API and the migration job (e.g. ALLOW_MOCK_PROVIDERS, provider selections)."
}

variable "rate_limit_per_minute" {
  type    = number
  default = 600
}

variable "auth_rate_limit_per_minute" {
  type    = number
  default = 20
}

# ---------------------------------------------------------------- access / edge
variable "domain" {
  type        = string
  default     = ""
  description = "Founder-approved domain (empty = PRIVATE mode: no public access at all; engineers reach services with `gcloud run services proxy`)."
}

variable "host_prefix" {
  type        = string
  default     = ""
  description = "Sub-domain segment that separates this environment, e.g. \"staging\" -> app.staging.<domain>. Empty for production."
}

variable "cloudflare_ipv4_ranges" {
  type        = list(string)
  description = "Cloudflare edge ranges allowed to reach the load balancer (https://www.cloudflare.com/ips-v4). Review when Cloudflare publishes changes."
  default = [
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  ]
}

# ---------------------------------------------------------------- operations
variable "alert_emails" {
  type        = list(string)
  default     = []
  description = "Addresses that receive uptime / error alerts."
}

variable "log_retention_days" {
  type        = number
  default     = 30
  description = "Retention of the in-region log bucket (market-specific; VALIDATE-<MARKET> retention answers decide production)."
}

variable "backup_retention_days" {
  type        = number
  default     = 30
  description = "Retention of the logical-backup bucket."
}

variable "lock_backup_retention" {
  type        = bool
  default     = false
  description = "Lock the backup bucket retention policy. IRREVERSIBLE — production only, after the founder approves retention."
}

variable "engineer_members" {
  type        = list(string)
  default     = []
  description = "IAM members (e.g. group:eng@<domain>) allowed to invoke services directly in PRIVATE mode (gcloud run services proxy)."
}

variable "trust_proxy_hops" {
  type        = number
  default     = null
  description = "Proxies in front of the API. Default: 2 behind Cloudflare + load balancer, 1 direct. Verify client IPs in the smoke test."
}

variable "github_repository" {
  type        = string
  description = "owner/repo allowed to deploy through Workload Identity Federation (no long-lived keys)."
}

variable "github_environment" {
  type        = string
  description = "GitHub environment whose jobs may deploy this cell (staging / production)."
}
