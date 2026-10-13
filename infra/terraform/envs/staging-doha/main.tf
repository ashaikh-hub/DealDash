# DealDash STAGING — Google Cloud Doha (me-central1). Founder-approved for staging only (2026-10-11); NOT the production decision.
# Synthetic data only. Never public: PRIVATE mode until a founder-approved domain exists, then Cloudflare Access in front.
terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.0, < 8.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = "me-central1"
  billing_project       = var.project_id
  user_project_override = true
}

module "cell" {
  source      = "../../modules/gcp-cell"
  project_id  = var.project_id
  region      = "me-central1"
  environment = "staging"

  # staging sizing: no HA, shared-core database, web apps may sleep (founder target <= USD 300 / month)
  db_tier              = "db-g1-small"
  db_high_availability = false
  db_pitr_days         = 7
  api_min_instances    = 1
  api_max_instances    = 2
  web_min_instances    = 0
  web_max_instances    = 2

  images = var.images
  app_env = {
    # UAT before contracts: development adapters may stand in (refused in production)
    ALLOW_MOCK_PROVIDERS = "true"
  }

  domain           = var.domain
  host_prefix      = "staging"
  engineer_members = var.engineer_members
  alert_emails     = var.alert_emails

  log_retention_days    = 30
  backup_retention_days = 30
  lock_backup_retention = false # never lock in staging

  github_repository  = var.github_repository
  github_environment = "staging"
}

# Budget alerts at 50 / 70 / 90 / 100 % of the founder's USD 600 ceiling (plus a forecast warning). Budgets ALERT, they do not stop
# spending: the hard limits are the sizing caps above (max instances, shared-core database, no HA, no load balancer until a domain).
resource "google_billing_budget" "staging" {
  billing_account = var.billing_account
  display_name    = "DealDash staging (Doha) — USD 600 ceiling"

  budget_filter {
    projects               = ["projects/${data.google_project.this.number}"]
    credit_types_treatment = "INCLUDE_ALL_CREDITS"
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = "600"
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.7, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
      spend_basis       = "CURRENT_SPEND"
    }
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  all_updates_rule {
    monitoring_notification_channels = slice(module.cell.notification_channels, 0, min(5, length(module.cell.notification_channels)))
    disable_default_iam_recipients   = false
  }
}

data "google_project" "this" {
  project_id = var.project_id
}

output "cell" {
  value = {
    artifact_registry          = module.cell.artifact_registry
    workload_identity_provider = module.cell.workload_identity_provider
    deployer_service_account   = module.cell.deployer_service_account
    services                   = module.cell.services
    migrate_job                = module.cell.migrate_job
    service_uris               = module.cell.service_uris
    public_hosts               = module.cell.public_hosts
    dns_records                = module.cell.dns_records
    buckets                    = module.cell.buckets
  }
}
