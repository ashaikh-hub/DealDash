# Secrets live in Secret Manager, replicated ONLY in the cell's region. Services receive them as secret references (never as plain
# environment values in the service definition). Generated values exist in the Terraform state: the state bucket must be private,
# versioned and in-region (see envs/*/backend.tf). Provider credentials (payment, SMS, ...) are added later as new secret versions
# by an authorised person — never committed, never in CI logs.
resource "random_password" "session" {
  length  = 48
  special = false
}

resource "random_password" "field_key" {
  length  = 48
  special = false
}

resource "random_password" "payout_webhook" {
  length  = 48
  special = false
}

resource "random_password" "notify_webhook" {
  length  = 48
  special = false
}

locals {
  secret_values = {
    DATABASE_URL          = local.database_url
    SESSION_SECRET        = random_password.session.result
    FIELD_ENCRYPTION_KEY  = random_password.field_key.result
    S3_ACCESS_KEY_ID      = google_storage_hmac_key.runtime.access_id
    S3_SECRET_ACCESS_KEY  = google_storage_hmac_key.runtime.secret
    PAYOUT_WEBHOOK_SECRET = random_password.payout_webhook.result
    NOTIFY_WEBHOOK_SECRET = random_password.notify_webhook.result
  }
}

resource "google_secret_manager_secret" "app" {
  for_each  = toset(keys(local.secret_values))
  project   = var.project_id
  secret_id = "${local.name}-${lower(replace(each.key, "_", "-"))}"
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "app" {
  for_each    = google_secret_manager_secret.app
  secret      = each.value.id
  secret_data = local.secret_values[each.key]
}

resource "google_secret_manager_secret_iam_member" "runtime" {
  for_each  = google_secret_manager_secret.app
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
