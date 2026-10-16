output "artifact_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
  description = "Image prefix for CI (GCP_ARTIFACT_REGISTRY)."
}

output "workload_identity_provider" {
  value       = google_iam_workload_identity_pool_provider.github.name
  description = "GitHub variable GCP_WORKLOAD_IDENTITY_PROVIDER."
}

output "deployer_service_account" {
  value = google_service_account.deployer.email
}

output "services" {
  value = { for k, s in local.all_services : k => s.name }
}

output "migrate_job" {
  value = google_cloud_run_v2_job.migrate.name
}

output "seed_job" {
  value       = var.enable_seed_job ? google_cloud_run_v2_job.seed[0].name : null
  description = "Staging only (G-2): one-off synthetic seed job, run with tooling/deploy/seed-gcp.mjs."
}

output "seed_secrets" {
  value       = [for s in google_secret_manager_secret.seed : s.secret_id]
  description = "Secret Manager NAMES (never values) of the seed password and the shared authenticator key."
}

output "service_uris" {
  value       = { for k, s in local.all_services : k => s.uri }
  description = "Direct Cloud Run URLs (PRIVATE mode: reachable only by named engineers through `gcloud run services proxy`)."
}

output "public_hosts" {
  value = local.hosts
}

output "host_suffix" {
  value       = local.edge ? local.suffix : null
  description = "GitHub variable STAGING_HOST_SUFFIX (G-4): each web image is built to call the API on its own https://<label>.<suffix>/v1."
}

output "load_balancer_ip" {
  value = local.edge ? google_compute_global_address.lb[0].address : null
}

output "dns_records" {
  description = "Create in Cloudflare: proxied A records to the load balancer, and the certificate DNS-authorisation CNAMEs (DNS only)."
  value = local.edge ? {
    a_records   = { for k, h in local.hosts : h => google_compute_global_address.lb[0].address }
    cert_cnames = { for k, a in google_certificate_manager_dns_authorization.host : a.dns_resource_record[0].name => a.dns_resource_record[0].data }
  } : null
}

output "notification_channels" {
  value = local.channels
}

output "database_connection" {
  value = google_sql_database_instance.pg.connection_name
}

output "buckets" {
  value = { files = google_storage_bucket.files.name, backups = google_storage_bucket.backups.name }
}
