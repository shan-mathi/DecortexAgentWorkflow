# Multi-stage build for the Workflow Engine service.
# Runs on ECS Fargate (ARM64).

# Stage 1: Install deps + build
FROM node:20-slim AS builder

WORKDIR /app

# Copy workspace root files needed for pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./

# Copy relevant packages
COPY packages/shared-types/ ./packages/shared-types/
COPY services/workflow-engine/ ./services/workflow-engine/

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

# Install dependencies
RUN pnpm install --frozen-lockfile --filter @agent-engine/workflow-engine...

# Build TypeScript
RUN pnpm --filter @agent-engine/shared-types build 2>/dev/null || true
RUN pnpm --filter @agent-engine/workflow-engine build 2>/dev/null || true

# Stage 2: Production image
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared-types ./packages/shared-types
COPY --from=builder /app/services/workflow-engine ./services/workflow-engine

WORKDIR /app/services/workflow-engine

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:4000/health || exit 1

CMD ["node", "--import", "tsx", "src/server.ts"]
