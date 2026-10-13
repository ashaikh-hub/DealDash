# DealDash infrastructure as code (Terraform)

- `modules/gcp-cell` — one complete, market-aware DealDash **cell** on Google Cloud: Cloud Run (API + 5 web apps), migration job,
  Cloud SQL PostgreSQL (PITR), private buckets (files, backups), Secret Manager (in-region replication), in-region log bucket, alerts,
  keyless GitHub deploys (Workload Identity Federation), and — only when a domain is set — a load balancer that admits Cloudflare only.
  Standard containers + PostgreSQL + S3-compatible storage keep every cell portable (another cloud or an onshore provider needs only a
  different module, never different application code).
- `envs/staging-doha` — **staging only**, Google Cloud Doha (`me-central1`), founder-approved 2026-10-11. Not the production decision.

Validated with Terraform 1.16.5 and `hashicorp/google` 7.46.1 (`terraform validate`: valid). **Not applied** — no cloud account exists yet.

## Access modes
| Mode | When | Who can reach staging |
|---|---|---|
| PRIVATE (default, `domain = ""`) | before the founder confirms the domain | nobody publicly; named engineers via `gcloud run services proxy` (smoke tests). Not usable for UAT |
| EDGE (`domain = "<domain>"`) | after the domain is confirmed and on Cloudflare | Cloudflare Access login on `*.staging.<domain>`; Cloud Armor rejects anything not coming from Cloudflare |

## First apply (after the founder creates the accounts)
1. Create the state bucket (see `envs/staging-doha/backend.tf`), copy `terraform.tfvars.example` to `terraform.tfvars`, fill it in.
2. `terraform init -backend-config="bucket=<project>-tfstate"` → `terraform plan` → review → `terraform apply`.
3. Set the GitHub `staging` environment variables from the outputs: `GCP_PROJECT`, `GCP_REGION=me-central1`, `GCP_ARTIFACT_REGISTRY`,
   `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOYER_SA`, `STAGING_API_URL` (EDGE: `https://api.staging.<domain>`), optional
   `STAGING_HEALTH_URL` and Cloudflare Access service-token secrets.
4. Tag a release → `.github/workflows/staging-gcp.yml` builds images (incl. the `migrate` target), scans them, runs the migration job,
   rolls out the API then the web apps, and checks `/v1/health/ready`. Production targets are refused by `tooling/deploy/deploy-gcp.mjs`.
5. EDGE mode: create the `dns_records` output in Cloudflare (proxied A records + DNS-only certificate CNAMEs) and an Access policy.

## Cost controls (founder ceiling USD 600 / month, target ≤ 300)
Budget alerts at 50 / 70 / 90 / 100 % (+ forecast). Budgets alert only — the caps are the sizing: shared-core zonal database, no HA,
API max 2 instances, web apps scale to zero, load balancer only in EDGE mode. Estimate: PRIVATE ≈ USD 110–170 / month, EDGE ≈ USD
145–215 / month (list prices, ±50%; Doha prices to confirm).

## Known items before production (not staging)
Separate migration and runtime database roles; regional HA; PITR 14 days; locked backup retention after the founder approves retention;
Cloudflare Access → production uses public routing with WAF instead; per-market `log_retention_days` / backup policy from VALIDATE answers.
