-- Schema for the Workflow Engine service.
--
-- Tables:
--   node_types        — categories/templates (LLM, HTTP, Branch, Transform, custom)
--   registered_nodes  — concrete instances extending a node type
--   workflows         — DAG definitions referencing registered nodes
--   workflow_nodes    — nodes within a workflow (references registered_nodes)
--   workflow_edges    — edges between workflow nodes
--   runs             — execution instances
--   node_executions  — per-node trace log (append-only, idempotent)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- Node Types: templates that define a category of node.
-- Each type has traits (e.g. LLM type has Bedrock access built-in).
CREATE TABLE IF NOT EXISTS node_types (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL UNIQUE,
  category       TEXT NOT NULL CHECK (category IN ('llm', 'http', 'branch', 'transform')),
  description    TEXT,
  version        TEXT NOT NULL DEFAULT '1.0.0',
  config_schema  JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the 4 base node types.
INSERT INTO node_types (id, name, category, description, config_schema) VALUES
  ('10000000-0000-4000-8000-000000000001', 'LLM', 'llm',
   'Calls a large language model (Bedrock) with a prompt template. Has built-in token tracking.',
   '{"type": "object", "properties": {"promptTemplate": {"type": "string"}, "model": {"type": "string", "default": "apac.amazon.nova-micro-v1:0"}, "maxTokens": {"type": "integer", "default": 1024}}, "required": ["promptTemplate"]}'),
  ('10000000-0000-4000-8000-000000000002', 'HTTP', 'http',
   'Calls an external REST API with configurable method, headers, and body template.',
   '{"type": "object", "properties": {"method": {"type": "string", "enum": ["GET","POST","PUT","PATCH","DELETE"]}, "url": {"type": "string"}, "headers": {"type": "object"}, "bodyTemplate": {"type": "string"}}, "required": ["url"]}'),
  ('10000000-0000-4000-8000-000000000003', 'Branch', 'branch',
   'Routes execution based on a sandboxed expression evaluated over upstream outputs.',
   '{"type": "object", "properties": {"expression": {"type": "string"}, "branches": {"type": "object"}, "default": {"type": "string"}}, "required": ["expression", "branches"]}'),
  ('10000000-0000-4000-8000-000000000004', 'Transform', 'transform',
   'Runs a sandboxed expression to reshape data between nodes.',
   '{"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}')
ON CONFLICT (name) DO NOTHING;

-- Registered Nodes: concrete instances that extend a Node Type with
-- custom config. Think of this as deploying custom code on top of a
-- template. Each node has a standard I/O format.
CREATE TABLE IF NOT EXISTS registered_nodes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  node_type_id    UUID NOT NULL REFERENCES node_types(id),
  category        TEXT NOT NULL,
  description     TEXT,
  config          JSONB NOT NULL DEFAULT '{}',
  version         TEXT NOT NULL DEFAULT '1.0.0',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

-- Workflows: DAG definitions.
CREATE TABLE IF NOT EXISTS workflows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workflow Nodes: references to registered nodes placed in a workflow.
-- position_x/y for UI rendering.
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id        UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id            TEXT NOT NULL,
  registered_node_id UUID NOT NULL REFERENCES registered_nodes(id),
  name               TEXT,
  config_override    JSONB DEFAULT '{}',
  position_x         INTEGER NOT NULL DEFAULT 0,
  position_y         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, node_id)
);

CREATE INDEX IF NOT EXISTS workflow_nodes_workflow_idx ON workflow_nodes (workflow_id);

-- Workflow Edges: define execution order and data flow.
CREATE TABLE IF NOT EXISTS workflow_edges (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id          UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  from_node            TEXT NOT NULL,
  to_node              TEXT NOT NULL,
  condition_expression TEXT
);

CREATE INDEX IF NOT EXISTS workflow_edges_workflow_idx ON workflow_edges (workflow_id);

-- Runs: one row per workflow execution.
CREATE TABLE IF NOT EXISTS runs (
  run_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id   UUID NOT NULL REFERENCES workflows(id),
  status        TEXT NOT NULL DEFAULT 'PENDING',
  input         JSONB NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runs_workflow_started_idx ON runs (workflow_id, started_at);

-- Node Executions: per-node trace, append-only.
-- PRIMARY KEY (run_id, node_id) ensures idempotent appends on retry.
CREATE TABLE IF NOT EXISTS node_executions (
  run_id            UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  node_id           TEXT NOT NULL,
  registered_node_id UUID,
  node_name         TEXT,
  node_type         TEXT,
  input             JSONB,
  output            JSONB,
  status            TEXT NOT NULL,
  duration_ms       INTEGER NOT NULL DEFAULT 0,
  error             JSONB,
  attempt_count     INTEGER NOT NULL DEFAULT 1,
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_usage       JSONB,
  PRIMARY KEY (run_id, node_id)
);
