# Tryout — GCP Infrastructure (Terraform)

Provisions the full production stack on GCP:

| Resource | What |
|----------|------|
| VPC + subnet + connector | Private network; Cloud Run reaches DB/Redis over private IP |
| Cloud SQL (Postgres 16) | `tryout` database, private IP only |
| Memorystore (Redis 7) | BullMQ queue backend, private IP only |
| Artifact Registry | Docker images for both services |
| Secret Manager | `database-url`, `jwt-secret`, `github-token`, `openai-api-key` |
| Cloud Run x2 | `tryout-api` + `tryout-web`, public |
| Service accounts | One per service, least privilege |

**Split of ownership:** Terraform owns *infrastructure*. Image versions are
owned by CD (`gcloud run deploy` or CI) — Terraform ignores image changes so a
deploy never gets reverted by the next `apply`.

## 1. Provision infra

```bash
cd infra/terraform
export TF_VAR_github_token=ghp_xxx
export TF_VAR_openai_api_key=sk-proj-xxx
cp terraform.tfvars.example terraform.tfvars   # set project_id, github_owner

terraform init
terraform plan
terraform apply
```

First `apply` deploys both Cloud Run services with a placeholder `hello` image.
That's expected — real images come next.

## 2. Build + push images, deploy

```bash
PROJECT=tryout-sre-lab-260703
REGION=us-central1
REG=$(terraform output -raw registry)
API_URL=$(terraform output -raw api_url)

# API
gcloud builds submit apps/api --tag $REG/api:latest --project $PROJECT
gcloud run deploy tryout-api --image $REG/api:latest --region $REGION --project $PROJECT

# Web — NEXT_PUBLIC_API_URL must be baked at BUILD time (see note below)
gcloud builds submit apps/web --tag $REG/web:latest --project $PROJECT \
  --build-arg NEXT_PUBLIC_API_URL=$API_URL
gcloud run deploy tryout-web --image $REG/web:latest --region $REGION --project $PROJECT
```

### Gotcha: Next.js build-time env

`NEXT_PUBLIC_API_URL` is inlined into the client bundle when the web image is
**built**, not when it runs. The Terraform runtime env only helps server
components. CI must pass it as a `--build-arg`, and `apps/web/Dockerfile` must
`ARG NEXT_PUBLIC_API_URL` + `ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL`
before `next build`.

## 3. Run DB migrations

Cloud SQL has private IP only. Run migrations from inside the VPC — a one-off
Cloud Run Job, or the Cloud SQL Auth Proxy from a bastion / Cloud Shell with a
temporary public IP. (Left as a deliberate next step — good migration-strategy
practice.)

## Tear down

```bash
terraform destroy
```

Cloud SQL + Memorystore bill 24/7, so destroy between sessions if you're not
running incident drills.
