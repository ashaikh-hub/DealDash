locals {
  name     = "${var.name_prefix}-${var.environment}"
  web_apps = toset(["customer", "merchant", "staff", "partner", "admin"])
  # public hostnames per service (founder naming principle: app., merchant., partner., admin., api.; staff added for Merchant Staff)
  host_label = { api = "api", customer = "app", merchant = "merchant", staff = "staff", partner = "partner", admin = "admin" }
  suffix     = var.host_prefix == "" ? var.domain : "${var.host_prefix}.${var.domain}"
  hosts      = var.domain == "" ? {} : { for k, v in local.host_label : k => "${v}.${local.suffix}" }
  edge       = var.domain != ""
}

resource "google_project_service" "apis" {
  for_each = toset(concat(
    ["run.googleapis.com", "sqladmin.googleapis.com", "artifactregistry.googleapis.com", "secretmanager.googleapis.com",
      "iam.googleapis.com", "iamcredentials.googleapis.com", "sts.googleapis.com", "monitoring.googleapis.com",
    "logging.googleapis.com", "storage.googleapis.com"],
    local.edge ? ["compute.googleapis.com", "certificatemanager.googleapis.com"] : [],
  ))
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# ---------------------------------------------------------------- identities
resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = "${local.name}-runtime"
  display_name = "DealDash ${var.environment} runtime (API, web apps, migration job)"
}

resource "google_project_iam_member" "runtime" {
  for_each = toset(["roles/cloudsql.client", "roles/logging.logWriter", "roles/monitoring.metricWriter"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.runtime.email}"
}

# ---------------------------------------------------------------- container registry (in-region)
resource "google_artifact_registry_repository" "images" {
  project                = var.project_id
  location               = var.region
  repository_id          = "${local.name}-images"
  format                 = "DOCKER"
  description            = "DealDash release images for ${var.environment}"
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent-releases"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }
  depends_on = [google_project_service.apis]
}
