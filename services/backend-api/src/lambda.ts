// Lambda entry point for the Backend API.
// Wraps the Fastify app with @fastify/aws-lambda so the same route
// code runs both locally (Fastify.listen) and on Lambda (API Gateway v2).

import awsLambdaFastify from "@fastify/aws-lambda";

import { buildApp } from "./app.js";

type Handler = (event: unknown, context: unknown) => Promise<unknown>;

let proxy: Handler | null = null;

async function getProxy(): Promise<Handler> {
  if (!proxy) {
    const app = await buildApp({
      engineUrl: process.env.WORKFLOW_ENGINE_URL,
      logger: true,
    });
    // awsLambdaFastify must be called BEFORE app.ready()
    const wrapped = awsLambdaFastify(app) as unknown as Handler;
    await app.ready();
    proxy = wrapped;
  }
  return proxy;
}

export async function handler(event: unknown, context: unknown): Promise<unknown> {
  const p = await getProxy();
  return p(event, context);
}
