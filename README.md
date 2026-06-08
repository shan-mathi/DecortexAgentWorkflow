# Agent Workflow Engine

A distributed agent workflow platform: define workflows as DAGs of typed nodes (LLM, HTTP, Branch, Transform), execute them with full tracing, and visualize results.

See [DESIGN.md](./DESIGN.md) for architecture, schema, API spec, and design decisions.

---

## Getting Started — Run UI Against Deployed Infrastructure

The workflow engine is deployed on AWS (Fargate + Lambda + RDS). You only need to run the React UI locally to interact with it.

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```sh
# 1. Clone and install dependencies
git clone <repo-url> && cd dcortex
pnpm install

# 2. Verify the API is reachable
curl https://fkvacbn6i8.execute-api.ap-south-1.amazonaws.com/api/health
# → {"status":"ok","engine":"connected"}
```

### Configure UI to point at deployed API

The file `services/ui/.env.development` should contain:

```env
VITE_API_URL=https://fkvacbn6i8.execute-api.ap-south-1.amazonaws.com
```

This is already set. If you're using a different deployment, update this URL to your API Gateway endpoint.

### Run the UI

```sh
pnpm dev:ui
```

Opens http://localhost:5173 — the React app calls the deployed AWS backend directly.

### What you can do

| Page | Description |
|------|-------------|
| **Workflows** | List, create, delete workflows |
| **Workflow Detail** | View DAG graph, click nodes to inspect/edit config, save changes, trigger execution |
| **Nodes** | View node types (LLM/HTTP/Branch/Transform), register new nodes, view config, delete |
| **Execute** | Trigger a workflow with JSON input |
| **Executions** | List all runs with status, duration |
| **Execution Trace** | Per-node detail: status, type, duration, token usage, input/output, errors |

### Example: Trigger an execution

1. Open http://localhost:5173
2. Go to **Workflows** → click a workflow (e.g. `ops-ticket-router`)
3. Click **Execute**
4. Enter input:
   ```json
   {
     "subject": "Production API returning 503 errors",
     "description": "All requests failing in us-east-1 since the 14:00 deploy. ALB shows 0 healthy targets."
   }
   ```
5. Click **Run**
6. View the execution trace — each node shows status, output, duration, and token usage

---

## Tests

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

## Available Commands

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all unit tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | Typecheck all services |
| `pnpm dev:ui` | Run only the UI (points at deployed API) |
| `pnpm dev` | Run all 3 services locally (requires local Postgres) |
| `pnpm dev:engine` | Run only the Workflow Engine locally (port 4000) |
| `pnpm dev:api` | Run only the Backend API locally (port 3000) |

---

## (Optional) Deploy to Your Own AWS Account

If you want to deploy the full stack to your own AWS account.

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

Edit `infra/.env` with your values:

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

This creates: VPC, RDS Postgres, ECS Fargate (Workflow Engine), Lambda (Backend API), API Gateway.

Note the output:
```
AgentEngine.ApiUrl = https://<id>.execute-api.<region>.amazonaws.com
```

### 7. Add the API URL to your env files

```sh
# Add to infra/.env (for seed script)
echo "API_URL=https://<id>.execute-api.<region>.amazonaws.com" >> infra/.env

# Add to UI (for local development against your deployment)
echo "VITE_API_URL=https://<id>.execute-api.<region>.amazonaws.com" > services/ui/.env.development
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
│   ├── backend-api/           Lambda: thin validation proxy to Engine
│   └── ui/                    React: workflow builder + execution viewer
├── infra/                     CDK: VPC + RDS + Fargate + Lambda + API Gateway
│   ├── lib/agent-engine-stack.ts
│   └── scripts/               build-and-push.sh, seed-deployed.sh
├── DESIGN.md                  Architecture documentation
└── README.md                  This file
```
