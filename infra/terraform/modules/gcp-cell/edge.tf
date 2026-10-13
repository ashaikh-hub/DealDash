# EDGE mode only (a founder-approved domain exists): Cloudflare (DNS, TLS, WAF, Access for staging) -> global external
# load balancer -> serverless NEGs -> Cloud Run. Cloud Armor admits only Cloudflare's edge ranges, so nobody bypasses Cloudflare
# (and its Access login for staging). Certificates come from Certificate Manager with DNS authorisation, which works behind the
# Cloudflare proxy: create the CNAME records from the `dns_records` output in Cloudflare.
resource "google_compute_global_address" "lb" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-lb-ip"
}

resource "google_compute_region_network_endpoint_group" "neg" {
  for_each              = local.edge ? local.all_services : {}
  project               = var.project_id
  name                  = "${local.name}-${each.key}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = each.value.name
  }
}

resource "google_compute_security_policy" "cloudflare_only" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-cloudflare-only"

  dynamic "rule" {
    # Cloud Armor allows at most 10 ranges per rule
    for_each = chunklist(var.cloudflare_ipv4_ranges, 10)
    content {
      action   = "allow"
      priority = 1000 + rule.key
      match {
        versioned_expr = "SRC_IPS_V1"
        config {
          src_ip_ranges = rule.value
        }
      }
      description = "Cloudflare edge"
    }
  }

  rule {
    action   = "deny(403)"
    priority = 2147483647
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "Everything else (no direct access)"
  }
}

resource "google_compute_backend_service" "svc" {
  for_each              = local.edge ? local.all_services : {}
  project               = var.project_id
  name                  = "${local.name}-${each.key}-be"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  protocol              = "HTTPS"
  security_policy       = google_compute_security_policy.cloudflare_only[0].id
  backend {
    group = google_compute_region_network_endpoint_group.neg[each.key].id
  }
  log_config {
    enable      = true
    sample_rate = 0.2
  }
}

resource "google_compute_url_map" "lb" {
  count           = local.edge ? 1 : 0
  project         = var.project_id
  name            = "${local.name}-urlmap"
  default_service = google_compute_backend_service.svc["customer"].id

  dynamic "host_rule" {
    for_each = local.hosts
    content {
      hosts        = [host_rule.value]
      path_matcher = host_rule.key
    }
  }
  dynamic "path_matcher" {
    for_each = local.hosts
    content {
      name            = path_matcher.key
      default_service = google_compute_backend_service.svc[path_matcher.key].id
    }
  }
}

resource "google_certificate_manager_dns_authorization" "host" {
  for_each = local.hosts
  project  = var.project_id
  name     = "${local.name}-${each.key}-dnsauth"
  domain   = each.value
}

resource "google_certificate_manager_certificate" "cert" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-cert"
  managed {
    domains            = values(local.hosts)
    dns_authorizations = [for a in google_certificate_manager_dns_authorization.host : a.id]
  }
}

resource "google_certificate_manager_certificate_map" "map" {
  count   = local.edge ? 1 : 0
  project = var.project_id
  name    = "${local.name}-certmap"
}

resource "google_certificate_manager_certificate_map_entry" "entry" {
  for_each     = local.hosts
  project      = var.project_id
  name         = "${local.name}-${each.key}-entry"
  map          = google_certificate_manager_certificate_map.map[0].name
  hostname     = each.value
  certificates = [google_certificate_manager_certificate.cert[0].id]
}

resource "google_compute_target_https_proxy" "lb" {
  count           = local.edge ? 1 : 0
  project         = var.project_id
  name            = "${local.name}-https"
  url_map         = google_compute_url_map.lb[0].id
  certificate_map = "//certificatemanager.googleapis.com/${google_certificate_manager_certificate_map.map[0].id}"
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.edge ? 1 : 0
  project               = var.project_id
  name                  = "${local.name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.lb[0].address
  port_range            = "443"
  target                = google_compute_target_https_proxy.lb[0].id
}
