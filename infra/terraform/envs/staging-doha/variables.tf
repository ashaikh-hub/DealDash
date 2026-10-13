variable "project_id" {
  type        = string
  description = "Staging project (FOUNDER / EXTERNAL ACTION: create the Google Cloud organisation, billing account and this project)."
}

variable "billing_account" {
  type        = string
  description = "Billing account id (XXXXXX-XXXXXX-XXXXXX) for the budget alerts."
}

variable "images" {
  type        = map(string)
  description = "First apply: a placeholder image for every service (CI replaces them on the first release)."
}

variable "domain" {
  type        = string
  default     = ""
  description = "Empty until the founder confirms the domain (PRIVATE mode)."
}

variable "engineer_members" {
  type    = list(string)
  default = []
}

variable "alert_emails" {
  type    = list(string)
  default = []
}

variable "github_repository" {
  type    = string
  default = "ashaikh-hub/DealDash"
}
