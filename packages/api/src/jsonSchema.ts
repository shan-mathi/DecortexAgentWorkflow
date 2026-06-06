// Zod-to-JSON-Schema conversion.
//
// Zod 4 ships its own `toJSONSchema` helper. We wrap it once so the
// route can swap out the implementation later (e.g. for cycle handling
// or vendor-specific schema dialects) without changing call sites.

import { z, type ZodType } from "zod";

export function schemaToJsonSchema(schema: ZodType<unknown>): unknown {
  return z.toJSONSchema(schema);
}
