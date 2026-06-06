// Centralised request-validation error responses.
//
// All routes that take a JSON body run the body through Zod and
// `replyValidationError` formats the response: HTTP 400 with a list
// of `{ path, message }` entries so the client can highlight the
// offending fields.

import type { FastifyReply } from "fastify";
import type { ZodError } from "zod";

export function replyValidationError(reply: FastifyReply, err: ZodError): FastifyReply {
  return reply.code(400).send({
    error: "ValidationError",
    issues: err.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
      code: i.code,
    })),
  });
}

export function replyDagViolations(
  reply: FastifyReply,
  violations: Array<{ kind: string }>,
): FastifyReply {
  return reply.code(400).send({
    error: "DagValidationError",
    violations,
  });
}
