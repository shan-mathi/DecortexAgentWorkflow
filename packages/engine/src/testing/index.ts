// Helpers exported for tests in other packages and the integration
// suite. Lives under `testing/` so it does not pollute the public
// engine surface.
//
// Note: `pluginContract` imports vitest at runtime, so it lives in a
// separate subpath (`./pluginContract`) to avoid pulling vitest into
// non-test bundles. The default `./testing` export only includes
// runtime-safe helpers.

export * from "./inMemoryRepos.js";
