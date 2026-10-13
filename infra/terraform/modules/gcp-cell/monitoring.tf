# Logs stay in the cell's region (market-aware residency): a regional log bucket receives everything, and the global _Default bucket
# is excluded. Retention per market comes from var.log_retention_days.
resource "google_logging_project_bucket_config" "regional" {
  project        = var.project_id
  location       = var.region
  bucket_id      = "${local.name}-logs"
  retention_days = var.log_retention_days
  depends_on     = [google_project_service.apis]
}

resource "google_logging_project_sink" "regional" {
  project                = var.project_id
  name                   = "${local.name}-to-regional-logs"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.regional.id}"
  filter                 = ""
  unique_writer_identity = true
}

resource "google_logging_project_exclusion" "default_bucket" {
  project     = var.project_id
  name        = "${local.name}-keep-logs-in-region"
  description = "Everything is routed to the regional bucket; nothing is stored in the global _Default bucket."
  filter      = "true"
}

resource "google_monitoring_notification_channel" "email" {
  for_each     = toset(var.alert_emails)
  project      = var.project_id
  display_name = "DealDash ${var.environment} alerts (${each.value})"
  type         = "email"
  labels = {
    email_address = each.value
  }
}

locals {
  channels = [for c in google_monitoring_notification_channel.email : c.id]
}

# Readiness probe from Google's uptime checkers (EDGE mode: through the public hostname; Cloudflare Access must allow the checker or
# the check uses a service token — see the runbook). PRIVATE mode relies on the error-rate and job alerts below.
resource "google_monitoring_uptime_check_config" "api_ready" {
  count        = local.edge ? 1 : 0
  project      = var.project_id
  display_name = "${local.name} API ready"
  timeout      = "10s"
  period       = "300s"
  http_check {
    path         = "/v1/health/ready"
    port         = 443
    use_ssl      = true
    validate_ssl = true
  }
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = var.project_id
      host       = local.hosts.api
    }
  }
}

resource "google_monitoring_alert_policy" "uptime" {
  count                 = local.edge ? 1 : 0
  project               = var.project_id
  display_name          = "${local.name}: API not ready"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "uptime check failing"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.api_ready[0].uptime_check_id}\""
      comparison      = "COMPARISON_GT"
      threshold_value = 1
      duration        = "600s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.host"]
      }
    }
  }
}

resource "google_monitoring_alert_policy" "server_errors" {
  project               = var.project_id
  display_name          = "${local.name}: API 5xx responses"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "5xx rate"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.label.service_name=\"${google_cloud_run_v2_service.api.name}\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 5
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}

resource "google_monitoring_alert_policy" "migration_failed" {
  project               = var.project_id
  display_name          = "${local.name}: migration job failed"
  combiner              = "OR"
  notification_channels = local.channels
  conditions {
    display_name = "failed executions"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/job/completed_execution_count\" AND resource.type=\"cloud_run_job\" AND resource.label.job_name=\"${google_cloud_run_v2_job.migrate.name}\" AND metric.label.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }
}
