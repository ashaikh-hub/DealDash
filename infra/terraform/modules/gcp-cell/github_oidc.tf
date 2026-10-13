# Keyless CI/CD: GitHub Actions exchanges its OIDC token for short-lived Google credentials. Only jobs of the named repository AND
# GitHub environment (protected: required reviewers for production) can deploy this cell. No service-account key exists anywhere.
resource "google_iam_workload_identity_pool" "github" {
  project                   = var.project_id
  workload_identity_pool_id = "${local.name}-github"
  display_name              = "GitHub ${var.environment}"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"
  attribute_mapping = {
    "google.subject"        = "assertion.sub"
    "attribute.repository"  = "assertion.repository"
    "attribute.environment" = "assertion.environment"
  }
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.environment == \"${var.github_environment}\""
  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account" "deployer" {
  project      = var.project_id
  account_id   = "${local.name}-deployer"
  display_name = "DealDash ${var.environment} deployer (GitHub Actions)"
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.environment/${var.github_environment}"
}

resource "google_project_iam_member" "deployer" {
  # run.invoker: the post-deploy readiness check calls /v1/health/ready with an identity token (private mode)
  for_each = toset(["roles/run.developer", "roles/artifactregistry.writer", "roles/run.invoker"])
  project  = var.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# the deployer may run revisions as the runtime identity, nothing more
resource "google_service_account_iam_member" "deployer_acts_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
