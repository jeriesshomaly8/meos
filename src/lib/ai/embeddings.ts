import { AiError } from "./types";

/**
 * Text embeddings for semantic memory (§v2.2).
 *
 * Gemini-only, deliberately: the vector column is pinned to 768 dimensions
 * (text-embedding-004), and OpenAI's models speak other sizes — mixing
 * providers would silently make distances meaningless. When the deployment
 * runs on OpenAI or the call fails, callers degrade to the ILIKE layer;
 * embeddings are an upgrade, never a dependency.
 */

// gemini-embedding-001, not text-embedding-004: Google shut the older model
// down in January 2026 (probed live — it 404s on this key). Truncation to 768
// is fine for cosine distance, which ignores scale.
const EMBED_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 10_000;
/** Embedding inputs are clipped, not rejected — a long note still embeds. */
const MAX_EMBED_CHARS = 6000;

export function isEmbeddingConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/**
 * One embedding, or null. Null rather than throw for everything except a
 * missing key: retrieval must never fail because an *optional* layer did.
 */
export async function embedText(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
): Promise<number[] | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiError("GEMINI_API_KEY is not set", "NOT_CONFIGURED");
  }
  const content = text.trim().slice(0, MAX_EMBED_CHARS);
  if (!content) return null;

  try {
    const response = await fetch(`${API_BASE}/${EMBED_MODEL}:embedContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        content: { parts: [{ text: content }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(`[embed] HTTP ${response.status}`);
      return null;
    }
    const payload = (await response.json()) as { embedding?: { values?: number[] } };
    const values = payload.embedding?.values;
    return Array.isArray(values) && values.length === EMBEDDING_DIMENSIONS ? values : null;
  } catch (error) {
    console.error("[embed] request failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * What a row *means*, as one string. Attributes are folded in because
 * "location: in the blue box" is precisely the meaning "where did I put the
 * spare key" must land on.
 */
export function embeddableText(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => part?.trim())
    .filter(Boolean)
    .join("\n");
}
