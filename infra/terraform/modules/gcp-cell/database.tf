# Managed PostgreSQL in the cell's region. The API reaches it through the Cloud SQL connector socket (/cloudsql/<connection>),
# which the production boot check accepts as encrypted transport. PostGIS is created by the migrations.
resource "google_sql_database_instance" "pg" {
  project             = var.project_id
  name                = "${local.name}-pg"
  region              = var.region
  database_version    = var.db_version
  deletion_protection = var.db_deletion_protection

  settings {
    tier              = var.db_tier
    edition           = "ENTERPRISE"
    availability_type = var.db_high_availability ? "REGIONAL" : "ZONAL"
    disk_autoresize   = true
    disk_size         = 10

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = var.db_pitr_days
      location                       = var.region # backups stay in-region (cross-border DR is a per-market decision)
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      ipv4_enabled = true # public IP with NO authorised networks: only the connector (IAM + mTLS) can reach it
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    database_flags {
      name  = "log_min_duration_statement"
      value = "1000"
    }

    insights_config {
      query_insights_enabled = true
    }

    maintenance_window {
      day  = 7
      hour = 1
    }
  }
  depends_on = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  name     = "dealdash_${var.environment}"
}

resource "random_password" "db" {
  length  = 32
  special = false
}

# Application role (the boot check refuses the administrative `postgres` account).
resource "google_sql_user" "app" {
  project  = var.project_id
  instance = google_sql_database_instance.pg.name
  name     = "dealdash_app"
  password = random_password.db.result
}

locals {
  database_url = "postgresql://${google_sql_user.app.name}:${random_password.db.result}@localhost/${google_sql_database.app.name}?host=/cloudsql/${google_sql_database_instance.pg.connection_name}"
}
