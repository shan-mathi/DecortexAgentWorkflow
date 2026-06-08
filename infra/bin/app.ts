#!/usr/bin/env node
// CDK app entry point.
// Single stack for the MVP to avoid cross-stack cyclic references.
// In production, split into Foundation + Engine + API with explicit SG exports.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as cdk from "aws-cdk-lib";

import { AgentEngineStack } from "../lib/agent-engine-stack.js";

// Load .env file
const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env");
try {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const [key, ...rest] = trimmed.split("=");
    if (key && rest.length > 0) {
      process.env[key] = rest.join("=");
    }
  }
} catch {
  // .env not found — rely on shell env vars
}

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? "",
  region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? "",
};

new AgentEngineStack(app, "AgentEngine", { env });

app.synth();
