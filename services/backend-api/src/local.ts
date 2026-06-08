// Local entry point for the Backend API.
// Runs Fastify on port 3000, forwards to Workflow Engine on port 4000.

import { buildApp } from "./app.js";

async function main() {
  const engineUrl = process.env.WORKFLOW_ENGINE_URL ?? "http://localhost:4000";
  const port = Number(process.env.PORT ?? 3000);

  const app = await buildApp({ engineUrl, logger: true });
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`[backend-api] listening on http://localhost:${port}`);
  console.log(`[backend-api] forwarding to workflow engine at ${engineUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
