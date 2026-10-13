# Private object storage, reached by the API's provider-neutral S3-compatible adapter (HMAC key of the runtime account).
resource "google_storage_bucket" "files" {
  project                     = var.project_id
  name                        = "${var.project_id}-${local.name}-files"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = 30
    }
    action {
      type = "Delete"
    }
  }

  # browsers upload / download directly with pre-signed URLs from the app origins only
  cors {
    origin          = local.edge ? [for k, h in local.hosts : "https://${h}" if k != "api"] : ["https://localhost.invalid"]
    method          = ["PUT", "GET", "HEAD"]
    response_header = ["Content-Type", "Content-Disposition", "ETag"]
    max_age_seconds = 3600
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket" "backups" {
  project                     = var.project_id
  name                        = "${var.project_id}-${local.name}-backups"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  retention_policy {
    retention_period = var.backup_retention_days * 86400
    is_locked        = var.lock_backup_retention
  }
  depends_on = [google_project_service.apis]
}

resource "google_storage_bucket_iam_member" "runtime_files" {
  bucket = google_storage_bucket.files.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_storage_hmac_key" "runtime" {
  project               = var.project_id
  service_account_email = google_service_account.runtime.email
}
