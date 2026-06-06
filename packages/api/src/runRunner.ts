// Async run-dispatch interface.
//
// The API layer accepts `POST /workflows/:id/runs`, persists a PENDING
// run, and immediately returns 202. The actual execution happens
// "elsewhere":
//   - locally: a `setImmediate` against the in-process engine
//   - in AWS: a Lambda invoked with `InvocationType=Event`
//
// Both modes implement the same `RunRunner` interface so the API
// route is identical in either deployment.

export interface RunRunner {
  trigger(args: {
    runId: string;
    workflowId: string;
    input: unknown;
  }): Promise<void> | void;
}

/**
 * Local in-process runner: dispatches the run via `setImmediate` so
 * the HTTP response is sent first.
 */
export function makeLocalRunner(
  fn: (args: { runId: string; workflowId: string; input: unknown }) => Promise<unknown>,
): RunRunner {
  return {
    trigger(args) {
      // We deliberately swallow errors here — the run trace will
      // capture failures, and a thrown rejection out of `setImmediate`
      // would crash the API process.
      setImmediate(() => {
        fn(args).catch((e) => {
          // eslint-disable-next-line no-console
          console.error("[run-runner] background error:", e);
        });
      });
    },
  };
}
