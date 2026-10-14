locals {
  api_public_url = local.edge ? "https://${local.hosts.api}" : "https://api.private.invalid"
  cors_origins   = local.edge ? join(",", [for k, h in local.hosts : "https://${h}" if k != "api"]) : "https://private.invalid"
  # Non-secret runtime settings shared by the API and the migration job. Production refuses unsafe values at boot.
  api_env = merge({
    NODE_ENV       = "production"
    APP_ENV        = var.environment
    API_PORT       = "4000"
    API_PUBLIC_URL = local.api_public_url
    CORS_ORIGINS   = local.cors_origins
    # launch readiness G-3: links in invitation messages open the environment's own merchant / partner portals (never localhost)
    MERCHANT_APP_URL           = local.edge ? "https://${local.hosts.merchant}" : "https://merchant.private.invalid"
    PARTNER_APP_URL            = local.edge ? "https://${local.hosts.partner}" : "https://partner.private.invalid"
    LOG_FORMAT                 = "json"
    RATE_LIMIT_PER_MINUTE      = tostring(var.rate_limit_per_minute)
    AUTH_RATE_LIMIT_PER_MINUTE = tostring(var.auth_rate_limit_per_minute)
    TRUST_PROXY_HOPS           = tostring(coalesce(var.trust_proxy_hops, local.edge ? 2 : 1))
    STORAGE_PROVIDER           = "s3"
    S3_ENDPOINT                = "https://storage.googleapis.com"
    S3_BUCKET                  = google_storage_bucket.files.name
    S3_REGION                  = "auto"
  }, var.app_env)
  ingress = local.edge ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
}

resource "google_cloud_run_v2_service" "api" {
  project             = var.project_id
  name                = "${local.name}-api"
  location            = var.region
  ingress             = local.ingress
  deletion_protection = false

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  template {
    service_account = google_service_account.runtime.email
    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = var.api_max_instances
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.pg.connection_name]
      }
    }
    containers {
      image = var.images["api"]
      ports {
        container_port = 4000
      }
      resources {
        limits            = { cpu = "1", memory = "1Gi" }
        cpu_idle          = false # jobs run in-process: CPU stays allocated
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = local.api_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = google_secret_manager_secret.app
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value.secret_id
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
      startup_probe {
        http_get {
          path = "/v1/health/live"
        }
        initial_delay_seconds = 5
        period_seconds        = 5
        failure_threshold     = 24
      }
      liveness_probe {
        http_get {
          path = "/v1/health/live"
        }
        period_seconds = 30
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.app, google_secret_manager_secret_iam_member.runtime]
}

resource "google_cloud_run_v2_service" "web" {
  for_each            = local.web_apps
  project             = var.project_id
  name                = "${local.name}-${each.key}"
  location            = var.region
  ingress             = local.ingress
  deletion_protection = false

  # Terraform owns the infrastructure; CI owns which release runs (gcloud deploy by tag). A plan never rolls a release back.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  template {
    service_account = google_service_account.runtime.email
    scaling {
      min_instance_count = var.web_min_instances
      max_instance_count = var.web_max_instances
    }
    containers {
      image = var.images[each.key] # NEXT_PUBLIC_API_URL is baked in at build time for this environment
      ports {
        container_port = 3000
      }
      resources {
        limits   = { cpu = "1", memory = "512Mi" }
        cpu_idle = true
      }
      startup_probe {
        tcp_socket {
          port = 3000
        }
        period_seconds    = 5
        failure_threshold = 24
      }
    }
  }
  depends_on = [google_project_service.apis]
}

# Release migrations: forward-only `prisma migrate deploy` + permission catalogue sync, run by the deploy step BEFORE traffic moves.
resource "google_cloud_run_v2_job" "migrate" {
  project             = var.project_id
  name                = "${local.name}-migrate"
  location            = var.region
  deletion_protection = false

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  template {
    task_count = 1
    template {
      service_account = google_service_account.runtime.email
      max_retries     = 0
      timeout         = "900s"
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.pg.connection_name]
        }
      }
      containers {
        image = var.images["migrate"]
        dynamic "env" {
          for_each = local.api_env
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = google_secret_manager_secret.app
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value.secret_id
                version = "latest"
              }
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.app, google_secret_manager_secret_iam_member.runtime]
}

# Launch readiness G-2 — the ONE-OFF staging seed (synthetic data), started by tooling/deploy/seed-gcp.mjs after the first release.
# Same image as the migration job, different command. It refuses anything but staging and any database that already has accounts.
resource "google_cloud_run_v2_job" "seed" {
  count               = var.enable_seed_job ? 1 : 0
  project             = var.project_id
  name                = "${local.name}-seed"
  location            = var.region
  deletion_protection = false

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
    precondition {
      condition     = var.environment == "staging"
      error_message = "The seed job exists only in staging (synthetic data). Production is never seeded."
    }
  }

  template {
    task_count = 1
    template {
      service_account = google_service_account.runtime.email
      max_retries     = 0
      timeout         = "1800s"
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.pg.connection_name]
        }
      }
      containers {
        image   = var.images["migrate"]
        command = ["node_modules/.bin/tsx"]
        args    = ["prisma/staging-seed.ts"]
        dynamic "env" {
          for_each = local.api_env
          content {
            name  = env.key
            value = env.value
          }
        }
        dynamic "env" {
          for_each = merge(google_secret_manager_secret.app, google_secret_manager_secret.seed)
          content {
            name = env.key
            value_source {
              secret_key_ref {
                secret  = env.value.secret_id
                version = "latest"
              }
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
    }
  }
  depends_on = [
    google_secret_manager_secret_version.app,
    google_secret_manager_secret_version.seed,
    google_secret_manager_secret_iam_member.runtime,
    google_secret_manager_secret_iam_member.seed_runtime,
  ]
}

# Who may call the services: in EDGE mode only the load balancer path exists (ingress), so the services accept unauthenticated
# requests from it; in PRIVATE mode nobody is public and named engineers invoke through `gcloud run services proxy`.
locals {
  all_services  = merge({ api = google_cloud_run_v2_service.api }, google_cloud_run_v2_service.web)
  invokers      = local.edge ? ["allUsers"] : var.engineer_members
  invoker_pairs = { for p in setproduct(keys(local.all_services), local.invokers) : "${p[0]}|${p[1]}" => { svc = p[0], member = p[1] } }
}

resource "google_cloud_run_v2_service_iam_member" "invoker" {
  for_each = local.invoker_pairs
  project  = var.project_id
  location = var.region
  name     = local.all_services[each.value.svc].name
  role     = "roles/run.invoker"
  member   = each.value.member
}
