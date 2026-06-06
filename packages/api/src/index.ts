// Public API of the api package.
//
// `buildApp` is consumed by both the local entry point and (eventually)
// the Lambda entry point. Tests import it directly to spin a Fastify
// instance against in-memory repos.

export * from "./app.js";
export * from "./runRunner.js";
