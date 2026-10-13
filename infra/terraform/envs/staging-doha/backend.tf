# Remote state in a private, versioned, IN-REGION bucket (state contains generated secrets: database password, session secret,
# HMAC key). Create it once before the first `terraform init`:
#   gcloud storage buckets create gs://<project_id>-tfstate --location=me-central1 --uniform-bucket-level-access --public-access-prevention
#   gcloud storage buckets update gs://<project_id>-tfstate --versioning
# then: terraform init -backend-config="bucket=<project_id>-tfstate"
terraform {
  backend "gcs" {
    prefix = "dealdash/staging-doha"
  }
}
