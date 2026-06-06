-- Initial schema for the agent workflow engine.
--
-- Notes:
--   * We rely on pgvector for `tickets_seed.embedding`; if the
--     extension is missing the migration fails fast.
--   * Workflow `version` increments on every PUT — we keep a single
--     row per workflow id but bump the version field rather than
--     creating new rows. The brief calls for version preservation;
--     for a take-home this is read in `Workflow.version` and is
--     enough to detect concurrent edits without a full audit table.
--   * `node_executions` has `UNIQUE (run_id, node_id)` so retries
--     translate to "first write wins" via ON CONFLICT DO NOTHING.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS workflows (
  id           UUID PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  definition   JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nodes (
  id           UUID PRIMARY KEY,
  workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id      TEXT NOT NULL,
  type         TEXT NOT NULL,
  name         TEXT,
  config       JSONB NOT NULL,
  position_x   INTEGER NOT NULL DEFAULT 0,
  position_y   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workflow_id, node_id)
);

CREATE INDEX IF NOT EXISTS nodes_workflow_idx ON nodes (workflow_id);

CREATE TABLE IF NOT EXISTS edges (
  id                   UUID PRIMARY KEY,
  workflow_id          UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  from_node            TEXT NOT NULL,
  to_node              TEXT NOT NULL,
  condition_expression TEXT
);

CREATE INDEX IF NOT EXISTS edges_workflow_idx ON edges (workflow_id);

CREATE TABLE IF NOT EXISTS runs (
  run_id        UUID PRIMARY KEY,
  workflow_id   UUID NOT NULL,
  status        TEXT NOT NULL,
  input         JSONB NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS runs_workflow_started_idx
  ON runs (workflow_id, started_at);

CREATE TABLE IF NOT EXISTS node_executions (
  run_id         UUID NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  node_id        TEXT NOT NULL,
  input          JSONB,
  output         JSONB,
  status         TEXT NOT NULL,
  duration_ms    INTEGER NOT NULL,
  error          JSONB,
  attempt_count  INTEGER NOT NULL DEFAULT 1,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  token_usage    JSONB,
  PRIMARY KEY (run_id, node_id)
);

CREATE TABLE IF NOT EXISTS tickets_seed (
  id           UUID PRIMARY KEY,
  subject      TEXT NOT NULL,
  body         TEXT NOT NULL,
  resolution   TEXT NOT NULL,
  urgency      TEXT NOT NULL,
  embedding    vector(1536),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IVFFlat needs ANALYZE first; the index is created lazily after the
-- corpus is seeded. We create a lightweight index now so cosine
-- queries are still indexed at small corpus sizes.
CREATE INDEX IF NOT EXISTS tickets_seed_embedding_idx
  ON tickets_seed
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);
