// Helpers for marshalling JS number arrays to pgvector's text format.
//
// pgvector's text input is `[1.0,2.0,3.0]` — same as the literal we'd
// hand-type in psql. Drizzle does not have a native vector type, so
// we cast in raw SQL: `$1::vector`.

export function toPgVector(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export function fromPgVector(s: string | null): number[] | null {
  if (!s) return null;
  // pgvector returns "[1,2,3]" when read as text.
  const trimmed = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1) : s;
  if (trimmed.length === 0) return [];
  return trimmed.split(",").map((n) => Number(n));
}
