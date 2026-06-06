// In-memory mock implementation of pgvector for testing without Docker.
// Implements cosine similarity search for vector retrieval tests.

import type { QueryRunner } from "@workflow-engine/engine";

export interface VectorRow {
  id: string;
  subject: string;
  body: string;
  resolution: string;
  urgency: string;
  embedding: number[];
}

// Cosine similarity between two vectors
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

export class MockVectorStore {
  private rows = new Map<string, VectorRow>();

  async insert(row: VectorRow): Promise<void> {
    this.rows.set(row.id, row);
  }

  async search(
    queryVector: number[],
    _knowledgeBase: string,
    topK: number,
  ): Promise<VectorRow[]> {
    const results = Array.from(this.rows.values())
      .map((row) => ({
        row,
        similarity: cosineSimilarity(queryVector, row.embedding),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK)
      .map((r) => ({ ...r.row, similarity: r.similarity }));

    return results;
  }

  clear(): void {
    this.rows.clear();
  }
}

export function createMockQueryRunner(vectorStore: MockVectorStore): QueryRunner {
  return {
    async query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> {
      // Handle pgvector similarity search queries
      if (
        sql.includes("SELECT id::text AS id") &&
        sql.includes("embedding <=>") &&
        sql.includes("FROM tickets_seed")
      ) {
        // KB retrieval query
        // Params: [vector_string, topK]
        const vectorStr = params[0] as string;
        const topK = params[1] as number;

        // Parse vector string format [x,y,z...]
        const vector = JSON.parse(vectorStr) as number[];
        const results = await vectorStore.search(vector, "tickets", topK);

        // Return rows with all fields
        const rows = results.map((r) => ({
          id: r.id,
          subject: r.subject,
          resolution: r.resolution,
          urgency: r.urgency,
          similarity: r.similarity,
        }));

        return { rows };
      }

      // INSERT query
      if (sql.includes("INSERT INTO tickets_seed")) {
        const [id, subject, body, resolution, urgency, embeddingStr] = params;
        // Parse the vector string format [x,y,z...]
        const embedding = JSON.parse(embeddingStr as string) as number[];
        await vectorStore.insert({
          id: id as string,
          subject: subject as string,
          body: body as string,
          resolution: resolution as string,
          urgency: urgency as string,
          embedding,
        });
        return { rows: [] };
      }

      return { rows: [] };
    },
  };
}
