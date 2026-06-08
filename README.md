# Agent Workflow Engine

A distributed agent workflow platform: define workflows as DAGs of typed nodes (LLM, HTTP, Branch, Transform), execute them with full tracing, and visualize results.

See [DESIGN.md](./DESIGN.md) for architecture, schema, API spec, and design decisions.
See [TESTING.md](./TESTING.md) for test strategy, C1/C2/C3 stance, and coverage details.

---

## 1. Local Development Setup

Run the entire system locally — all 3 services + Postgres. Uses a mock LLM (no AWS credentials needed).

### Prerequisites

- **Node.js 20+** — `node --version`
- **pnpm 9+** — `npm install -g pnpm`
- **PostgreSQL 17** with **pgvector** extension

### Step 1: Install PostgreSQL + pgvector (macOS)

```sh
brew install postgresql@17 pgvector
brew services start postgresql@17

# Add pg binaries to PATH
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
# (Add this line to ~/.zshrc to persist)
```

### Step 2: Setup the database

```sh
# Create postgres role (skip if already exists)
createuser -s postgres 2>/dev/null

# Set password
psql -U postgres -c "ALTER USER postgres WITH PASSWORD 'postgres';"

# Enable pgvector extension
psql -U postgres -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Run migrations (creates all tables + seeds node types)
psql -U postgres -f services/workflow-engine/migrations/0001_init.sql
```

### Step 3: Install dependencies

```sh
pnpm install
```

### Step 4: Configure UI for local development

Ensure `services/ui/.env.development` has the `VITE_API_URL` line **commented out**:

```env
# Comment this out for local dev (Vite proxy handles routing to localhost:3000)
# VITE_API_URL=https://fkvacbn6i8.execute-api.ap-south-1.amazonaws.com
```

When `VITE_API_URL` is unset, the UI uses the Vite dev proxy which routes `/api/*` to `localhost:3000` (the local Backend API).

### Step 5: Kill any existing processes on required ports

```sh
# Free up ports 3000, 4000, 5173 if occupied from a previous run
lsof -ti:3000 | xargs kill 2>/dev/null
lsof -ti:4000 | xargs kill 2>/dev/null
lsof -ti:5173 | xargs kill 2>/dev/null
```

### Step 6: Start all services

```sh
pnpm dev
```

This starts concurrently:
| Service | Port | LLM Mode |
|---------|------|----------|
| Workflow Engine | http://localhost:4000 | Mock (`LLM_PROVIDER=fake` by default) |
| Backend API | http://localhost:3000 | Proxies to Engine |
| UI | http://localhost:5173 | Vite proxy → Backend API |

### Step 7: Seed sample data

In a separate terminal:

```sh
API_URL=http://localhost:3000 ./infra/scripts/seed-deployed.sh
```

This registers 4 nodes (classify-ticket, branch-urgency, draft-urgent, draft-low) and creates the `ops-ticket-router` workflow.

### Step 8: Verify

```sh
# Health check
curl http://localhost:3000/api/health
# → {"status":"ok","engine":"connected"}

# List workflows
curl http://localhost:3000/api/workflows
# → [{"id":"...","name":"ops-ticket-router","version":1}]
```

Open http://localhost:5173 in your browser.

### Mock LLM behaviour

When running locally, `LLM_PROVIDER` defaults to `fake`. The mock LLM:
- Returns `"HIGH"` for prompts with outage/503/down/critical keywords
- Returns `"MED"` for slow/intermittent/lag keywords
- Returns `"LOW"` for everything else
- Returns a generic acknowledgement for non-classification prompts

This lets the full workflow execute end-to-end without AWS credentials or Bedrock access.

---

## 2. Run UI Against Deployed Infrastructure

If infrastructure is already deployed on AWS, you only need to run the UI locally.

### Prerequisites

- Node.js 20+, pnpm 9+

### Setup

```sh
pnpm install
```

### Configure UI to point at deployed API

Edit `services/ui/.env.development`:

```env
VITE_API_URL=https://fkvacbn6i8.execute-api.ap-south-1.amazonaws.com
```

### Run

```sh
pnpm dev:ui
```

Opens http://localhost:5173 — calls the deployed AWS backend directly (no local Postgres or Engine needed).

### Verify the API is reachable

```sh
curl https://fkvacbn6i8.execute-api.ap-south-1.amazonaws.com/api/health
# → {"status":"ok","engine":"connected"}
```

---

## 3. Tests

```sh
pnpm test          # run all tests (58 tests, <1s)
pnpm test:watch    # watch mode
pnpm typecheck     # typecheck all services
```

### Test coverage

| Service | Tests | What's covered |
|---------|-------|----------------|
| workflow-engine | `tst/executor/dag.test.ts` | DAG validation (cycles, dangling edges, duplicates) + topological sort (linear, diamond, property test with 30 random DAGs) |
| workflow-engine | `tst/executor/template.test.ts` | Template resolution: input paths, node paths, JSON stringify, arrays, whitespace, missing refs |
| workflow-engine | `tst/executor/sandbox.test.ts` | Expression sandbox: arithmetic, ternary, member access, helpers, logical ops, deny list, parse errors |
| workflow-engine | `tst/nodes/handlers.test.ts` | Branch (routing, default, no-match, hyphen alias), Transform (eval, input bindings, errors), LLM mock (classify HIGH/LOW, generic text, missing config, token usage) |
| backend-api | `tst/api.test.ts` | All routes via Fastify inject against a mock engine: health, CRUD, validation (400), payload limit (413), proxy behaviour |

---

## 4. Available Commands

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | Typecheck all services |
| `pnpm dev` | Run all 3 services locally (requires local Postgres) |
| `pnpm dev:ui` | Run only the UI |
| `pnpm dev:engine` | Run only the Workflow Engine (port 4000) |
| `pnpm dev:api` | Run only the Backend API (port 3000) |

---

## 5. (Optional) Deploy to Your Own AWS Account

Deploy the full stack to your own AWS account.

### Prerequisites

- Docker (via [Colima](https://github.com/abiosoft/colima) or Docker Desktop)
- AWS CLI v2 with credentials configured
- Node.js 20+, pnpm 9+

### 1. Install Docker via Colima (macOS)

```sh
brew install colima docker
colima start --arch aarch64 --cpu 4 --memory 8
docker --version   # verify
```

### 2. Configure AWS CLI

```sh
aws configure
# AWS Access Key ID: <your-key>
# AWS Secret Access Key: <your-secret>
# Default region name: <your-region>
# Default output format: json

aws sts get-caller-identity   # verify
```

### 3. Create your environment file

```sh
cp infra/.env.sample infra/.env
```

Edit `infra/.env`:

```env
AWS_ACCOUNT_ID=<your-account-id>
AWS_REGION=<your-region>
CDK_DEFAULT_ACCOUNT=<your-account-id>
CDK_DEFAULT_REGION=<your-region>
ENGINE_IMAGE_URI=<account>.dkr.ecr.<region>.amazonaws.com/agent-engine/workflow-engine:latest
LLM_PROVIDER=bedrock
LOG_LEVEL=info
```

### 4. Bootstrap CDK (first time only)

```sh
cd infra
npx cdk bootstrap aws://<your-account-id>/<your-region>
```

### 5. Build and push Docker image

```sh
./infra/scripts/build-and-push.sh
```

### 6. Deploy the stack

```sh
cd infra
npx cdk deploy
```

Note the output:
```
AgentEngine.ApiUrl = https://<id>.execute-api.<region>.amazonaws.com
```

### 7. Configure environment with the deployed URL

```sh
# Add to infra/.env (for seed script)
# API_URL=https://<id>.execute-api.<region>.amazonaws.com

# Add to UI .env.development (to use deployed API from local UI)
# VITE_API_URL=https://<id>.execute-api.<region>.amazonaws.com
```

### 8. Seed the database

```sh
./infra/scripts/seed-deployed.sh
```

### 9. Verify

```sh
curl https://<id>.execute-api.<region>.amazonaws.com/api/health
# → {"status":"ok","engine":"connected"}

pnpm dev:ui
# Open http://localhost:5173
```

### Updating after code changes

```sh
# Engine changes (Fargate)
./infra/scripts/build-and-push.sh
aws ecs update-service \
  --cluster $(aws ecs list-clusters --region <region> --query 'clusterArns[0]' --output text) \
  --service $(aws ecs list-services --cluster $(aws ecs list-clusters --region <region> --query 'clusterArns[0]' --output text) --region <region> --query 'serviceArns[0]' --output text) \
  --force-new-deployment --region <region>

# Backend API changes (Lambda) — CDK rebundles automatically
cd infra && npx cdk deploy
```

### Teardown

```sh
cd infra
npx cdk destroy
```

---

## Project Structure

```
agent-workflow-engine/
├── services/
│   ├── workflow-engine/       Fargate: DAG executor + workflow CRUD + Postgres
│   │   ├── src/db/           DB repositories
│   │   ├── src/executor/     DAG validation, topo sort, run orchestrator
│   │   ├── src/nodes/        Node handlers (LLM/HTTP/Branch/Transform)
│   │   ├── src/types/        Shared type interfaces
│   │   ├── src/workflow/     Service layer
│   │   ├── tst/              Unit tests
│   │   └── migrations/       SQL schema
│   ├── backend-api/           Lambda: validation proxy to Engine
│   │   ├── src/routes/       Route handlers
│   │   └── tst/              Unit tests
│   └── ui/                    React: workflow builder + execution viewer
│       └── src/pages/        Page components
├── infra/                     CDK: VPC + RDS + Fargate + Lambda + API Gateway
│   ├── lib/                  Stack definition
│   └── scripts/              build-and-push.sh, seed-deployed.sh
├── DESIGN.md                  Architecture documentation
├── TESTING.md                 Test strategy (C1/C2/C3)
└── README.md                  This file
```
