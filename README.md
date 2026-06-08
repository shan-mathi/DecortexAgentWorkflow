# Agent Workflow Engine

A distributed agent workflow platform: define workflows as DAGs of typed nodes (LLM, HTTP, Branch, Transform), execute them with full tracing, and visualize results.

See [DESIGN.md](./DESIGN.md) for architecture, schema, API spec, and design decisions.

---

## 1. Local Development Setup

Run all 3 services locally with a mock LLM (no AWS credentials required).

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 16/17 with pgvector extension

### Install PostgreSQL + pgvector (macOS)

```sh
# Install Postgres 17
brew install postgresql@17
brew services start postgresql@17

# Add to PATH
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# (Add this to ~/.zshrc to persist)

# Install pgvector
brew install pgvector

# Create the postgres user (if not exists)
createuser -s postgres 2>/dev/null
psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"

# Enable pgvector extension
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

### Install dependencies

```sh
pnpm install
```

### Run database migrations

```sh
psql -U postgres -f services/workflow-engine/migrations/0001_init.sql
```

This creates all tables (`node_types`, `registered_nodes`, `workflows`, `workflow_nodes`, `workflow_edges`, `runs`, `node_executions`) and seeds the 4 base node types (LLM, HTTP, Branch, Transform).

### Start all services

```sh
pnpm dev
```

This starts concurrently:
- **Workflow Engine** on `http://localhost:4000` (LLM_PROVIDER defaults to `fake`)
- **Backend API** on `http://localhost:3000` (proxies to Engine)
- **UI** on `http://localhost:5173` (Vite proxy → Backend API)

### Verify

```sh
# Health check (Engine)
curl http://localhost:4000/health
# → {"status":"ok"}

# Health check (Backend API → Engine)
curl http://localhost:3000/api/health
# → {"status":"ok","engine":"connected"}

# List node types
curl http://localhost:3000/api/node-types
# → [{"id":"...","name":"LLM","category":"llm",...}, ...]
```

Open http://localhost:5173 in your browser.

### Seed sample workflow (optional)

Register nodes and create the ops-ticket-router workflow locally:

```sh
# Register a classify node
curl -X POST http://localhost:3000/api/nodes \
  -H 'content-type: application/json' \
  -d '{"name":"classify-ticket","nodeTypeId":"10000000-0000-4000-8000-000000000001","category":"llm","config":{"promptTemplate":"Classify urgency as LOW, MED, or HIGH. Reply with only the label. Subject: {{input.subject}} Description: {{input.description}}"}}'
```

Or use the UI: go to **Nodes** → **Register Node** → pick LLM type → fill config.

### Mock LLM behaviour

When `LLM_PROVIDER=fake` (the default for local dev), the LLM handler returns:
- `"HIGH"` / `"MED"` / `"LOW"` for prompts containing "reply with only the label"
- A generic acknowledgement for any other prompt

This allows the full workflow to execute without AWS credentials or Bedrock access.

---

## 2. Deploy to AWS

Deploy the full stack: VPC + RDS Postgres + ECS Fargate (Workflow Engine) + Lambda + API Gateway (Backend API).

### Prerequisites

- Docker (via Colima or Docker Desktop)
- AWS CLI v2 configured
- Node.js 20+, pnpm 9+

### Install Docker via Colima (macOS)

```sh
brew install colima docker

# Start Colima (Docker runtime)
colima start --arch aarch64 --cpu 4 --memory 8

# Verify
docker --version
docker info
```

### Configure AWS CLI

```sh
aws configure
# AWS Access Key ID: <your-key>
# AWS Secret Access Key: <your-secret>
# Default region name: ap-south-1
# Default output format: json

# Verify
aws sts get-caller-identity
# → {"Account": "141132233781", ...}
```

### Bootstrap CDK (first time only)

```sh
cd infra
npx cdk bootstrap aws://141132233781/ap-south-1
```

### Create ECR repository and push Docker image

```sh
# From repo root
./infra/scripts/build-and-push.sh
```

This script:
1. Creates the ECR repo `agent-engine/workflow-engine` (if not exists)
2. Logs into ECR
3. Builds the Docker image from `services/workflow-engine/Dockerfile`
4. Pushes to `141132233781.dkr.ecr.ap-south-1.amazonaws.com/agent-engine/workflow-engine:latest`

### Deploy the CDK stack

```sh
cd infra
npx cdk deploy
```

Deploys:
- VPC (2 AZs, NAT gateway, public/private/isolated subnets)
- RDS Postgres 16.14 (t4g.micro, encrypted, isolated subnet)
- ECS Fargate (Workflow Engine, ARM64, auto-scales 1→4)
- Internal ALB (Engine access within VPC)
- Lambda (Backend API, ARM64, 256MB, ESM bundled)
- API Gateway HTTP API (public, CORS enabled)

**Outputs** (note these after deploy):
```
AgentEngine.ApiUrl = https://<id>.execute-api.ap-south-1.amazonaws.com
AgentEngine.EngineUrl = http://internal-<alb-dns>.ap-south-1.elb.amazonaws.com
AgentEngine.DbEndpoint = <rds-endpoint>.ap-south-1.rds.amazonaws.com
AgentEngine.DbSecretArn = arn:aws:secretsmanager:ap-south-1:141132233781:secret:agent-engine/db-credentials-<suffix>
```

### Seed the deployed database

After deployment, the Fargate task auto-runs migrations on startup. Seed the demo workflow:

```sh
./infra/scripts/seed-deployed.sh
```

### Verify deployed API

```sh
curl https://<your-api-id>.execute-api.ap-south-1.amazonaws.com/api/health
# → {"status":"ok","engine":"connected"}

curl https://<your-api-id>.execute-api.ap-south-1.amazonaws.com/api/node-types
# → [{...LLM...}, {...HTTP...}, {...Branch...}, {...Transform...}]
```

### Update Fargate (after code changes)

```sh
# Rebuild + push image
./infra/scripts/build-and-push.sh

# Force ECS to pull new image
aws ecs update-service \
  --cluster $(aws ecs list-clusters --region ap-south-1 --query 'clusterArns[0]' --output text) \
  --service $(aws ecs list-services --cluster $(aws ecs list-clusters --region ap-south-1 --query 'clusterArns[0]' --output text) --region ap-south-1 --query 'serviceArns[0]' --output text) \
  --force-new-deployment \
  --region ap-south-1
```

### Update Lambda (after code changes)

```sh
cd infra
npx cdk deploy
# CDK auto-bundles the Lambda from services/backend-api/src/lambda.ts
```

---

## 3. Use Deployed Infrastructure via Local UI

Run the React UI locally but point it at the already-deployed AWS backend. No need to run Engine or Backend API locally.

### Setup

Edit `services/ui/.env.development`:

```env
VITE_API_URL=https://fkvacbn6i8.execute-api.ap-south-1.amazonaws.com
```

### Run

```sh
pnpm dev:ui
```

This starts only the UI on http://localhost:5173, calling the deployed API Gateway directly.

### What you can do

- **Nodes page**: view node types, register new nodes, delete nodes
- **Workflows page**: list workflows, create new ones, delete
- **Workflow detail**: view the DAG graph, click nodes to inspect config, edit config overrides, save
- **Execute**: trigger a workflow with JSON input
- **Execution trace**: view per-node status, duration, token usage, input/output, errors

### Example: trigger an execution

1. Open http://localhost:5173
2. Go to **Workflows** → click **ops-ticket-router**
3. Click **Execute**
4. Enter:
   ```json
   {
     "subject": "Production API returning 503 errors",
     "description": "All requests failing in us-east-1 since the 14:00 deploy. ALB shows 0 healthy targets."
   }
   ```
5. Click **Run**
6. Watch the execution trace — each node shows status, output, duration, and token usage

---

## Quick Reference

| Command | What it does |
|---------|-------------|
| `pnpm dev` | Start all 3 services locally |
| `pnpm dev:engine` | Start only Workflow Engine (port 4000) |
| `pnpm dev:api` | Start only Backend API (port 3000) |
| `pnpm dev:ui` | Start only UI (port 5173) |
| `pnpm typecheck` | Typecheck all packages |
| `cd infra && npx cdk deploy` | Deploy to AWS |
| `./infra/scripts/build-and-push.sh` | Build + push Docker image to ECR |
| `./infra/scripts/seed-deployed.sh` | Seed the deployed DB with demo workflow |
