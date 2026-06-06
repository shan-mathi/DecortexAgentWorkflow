// Drizzle schema. We keep raw SQL migrations as the source of truth
// (`migrations/0001_init.sql`) but mirror the structure here so query
// builders are typed.
//
// `embedding` on `tickets_seed` is `vector(1536)` — pgvector's column
// type. Drizzle does not have a native vector type yet, so we use
// `text` with an `as.vector` cast in the query layer.

import { sql } from "drizzle-orm";
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workflows = pgTable("workflows", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  version: integer("version").notNull().default(1),
  definition: jsonb("definition").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export const nodes = pgTable(
  "nodes",
  {
    id: uuid("id").primaryKey(),
    workflowId: uuid("workflow_id").notNull(),
    nodeId: text("node_id").notNull(),
    type: text("type").notNull(),
    name: text("name"),
    config: jsonb("config").notNull(),
    positionX: integer("position_x").notNull().default(0),
    positionY: integer("position_y").notNull().default(0),
  },
  (t) => ({
    workflowNodeUnique: uniqueIndex("nodes_workflow_node_unique").on(
      t.workflowId,
      t.nodeId,
    ),
  }),
);

export const edges = pgTable("edges", {
  id: uuid("id").primaryKey(),
  workflowId: uuid("workflow_id").notNull(),
  fromNode: text("from_node").notNull(),
  toNode: text("to_node").notNull(),
  conditionExpression: text("condition_expression"),
});

export const runs = pgTable("runs", {
  runId: uuid("run_id").primaryKey(),
  workflowId: uuid("workflow_id").notNull(),
  status: text("status").notNull(),
  input: jsonb("input").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const nodeExecutions = pgTable(
  "node_executions",
  {
    runId: uuid("run_id").notNull(),
    nodeId: text("node_id").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    status: text("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    error: jsonb("error"),
    attemptCount: integer("attempt_count").notNull().default(1),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    tokenUsage: jsonb("token_usage"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.runId, t.nodeId] }),
  }),
);

export const ticketsSeed = pgTable("tickets_seed", {
  id: uuid("id").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  resolution: text("resolution").notNull(),
  urgency: text("urgency").notNull(),
  // Stored as `vector(1536)`; queried via raw SQL for cosine-distance.
  embedding: text("embedding"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
