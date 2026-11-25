import { AiError, type AiProvider, type JsonRequest, type TextRequest } from "./types";

/**
 * Google Gemini via the REST generateContent endpoint.
 *
 * Deliberately uses `fetch` rather than an SDK: the Google JS SDKs have churned
 * through several incompatible shapes, while the v1beta REST contract
 * (generationConfig.responseMimeType + responseSchema) has stayed stable.
 *
 * Free tier: quotas are per-project and Google adjusts them; check your live
 * limits at https://aistudio.google.com/rate-limit. A 429 is surfaced as
 * QUOTA_EXCEEDED so the UI can say "daily free limit" rather than "error".
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/**
 * An alias, not a pinned version, on purpose: Google retires pinned model ids
 * for new API keys (`gemini-2.5-flash` started returning 404 "no longer
 * available to new users"), which takes the whole inbox down. The alias always
 * resolves to the current free-tier flash model. Pin with GEMINI_MODEL if you
 * need reproducible extraction output.
 */
const DEFAULT_MODEL = "gemini-flash-latest";
/**
 * Where requests go when the main model is drowning. Overload is per-model —
 * the lite tier has its own capacity and higher rate limits — so a demand
 * spike on flash (observed live: 85s of 503 "high demand") doesn't have to
 * take MeOS down with it. Slightly weaker model beats no model.
 */
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const TIMEOUT_MS = 45_000;

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

function model(): string {
  return process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
}

/**
 * Escalating retries, transient failures only. The free tier fails in
 * BURSTS — overload 503s and latency spikes that outlive a single quick
 * retry — so three attempts with growing gaps, plus honouring the
 * retry-after a 429 carries when it names a short one (a per-minute rate
 * blip, not the daily quota). Anything meaningful — a bad key, a missing
 * model, a real quota — still fails fast: retrying those returns the same
 * answer slower.
 */
const RETRY_DELAYS_MS = [900, 2_600];
/** A 429 asking for a wait longer than this is the daily quota, not a blip. */
const MAX_RETRY_AFTER_S = 12;

function retryAfterSeconds(detail: string): number | null {
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(detail);
  return match ? Number(match[1]) : null;
}

async function callGemini(body: Record<string, unknown>): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiError("GEMINI_API_KEY is not set", "NOT_CONFIGURED");
  }

  const attempt = (modelName: string) =>
    fetch(`${API_BASE}/${modelName}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  let response: Response | null = null;
  for (let round = 0; round <= RETRY_DELAYS_MS.length; round += 1) {
    const lastRound = round === RETRY_DELAYS_MS.length;
    // The last round jumps ship to the fallback model: a spike is per-model,
    // and two more knocks on a drowning door help nobody.
    const roundModel = lastRound && model() !== FALLBACK_MODEL ? FALLBACK_MODEL : model();
    try {
      response = await attempt(roundModel);
      if (lastRound && roundModel === FALLBACK_MODEL && response.ok) {
        console.error("[gemini] fallback model answered while primary was overloaded");
      }
    } catch (error) {
      // Network failure or timeout. The user's text is never logged.
      console.error("[gemini] request failed:", error instanceof Error ? error.message : error);
      if (lastRound) throw new AiError("Could not reach the AI service", "PROVIDER_ERROR");
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[round]));
      continue;
    }

    if (response.status >= 500 && !lastRound) {
      console.error(`[gemini] HTTP ${response.status}, retry ${round + 1}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[round]));
      continue;
    }

    if (response.status === 429 && !lastRound) {
      // Peek at the body: a short retryDelay is a per-minute blip worth
      // riding out; anything longer (or unstated) is the daily quota and the
      // honest answer is the quota message, now.
      let waitS: number | null = null;
      try {
        waitS = retryAfterSeconds(await response.clone().text());
      } catch {
        waitS = null;
      }
      if (waitS !== null && waitS <= MAX_RETRY_AFTER_S) {
        console.error(`[gemini] HTTP 429, waiting ${waitS}s as asked`);
        await new Promise((resolve) => setTimeout(resolve, waitS * 1000 + 250));
        continue;
      }
    }

    break;
  }
  if (!response) throw new AiError("Could not reach the AI service", "PROVIDER_ERROR");

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as GeminiResponse;
      detail = payload.error?.message ?? "";
    } catch {
      // Non-JSON error body; status alone is enough to classify.
    }
    console.error(`[gemini] HTTP ${response.status}: ${detail}`);
    if (response.status === 429) {
      throw new AiError("Gemini free-tier quota reached", "QUOTA_EXCEEDED");
    }
    if (response.status === 401 || response.status === 403) {
      throw new AiError("Gemini rejected the API key", "NOT_CONFIGURED");
    }
    // Google answers an invalid key with 400, not 401 — leaving it to the
    // generic branch below dressed a configuration mistake up as a passing
    // outage, which is exactly how a dead key survived in production unnoticed.
    if (response.status === 400 && /api key not valid/i.test(detail)) {
      throw new AiError("Gemini rejected the API key", "NOT_CONFIGURED");
    }
    if (response.status === 404) {
      throw new AiError(
        `Gemini model "${model()}" is not available to this API key`,
        "MODEL_UNAVAILABLE",
        404,
      );
    }
    throw new AiError("The AI service returned an error", "PROVIDER_ERROR", response.status);
  }

  const payload = (await response.json()) as GeminiResponse;

  if (payload.promptFeedback?.blockReason) {
    throw new AiError("The AI declined to process that text", "BAD_RESPONSE");
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new AiError("The AI returned an empty response", "BAD_RESPONSE");
  }
  return text;
}

/**
 * Translate the shared JSON Schema into the OpenAPI 3.0 subset Gemini's
 * responseSchema accepts. Two keywords in the shared schema are fatal here:
 * `additionalProperties` (unknown field — rejected outright) and array-form
 * `type: ["string", "null"]` (Gemini spells nullability as `nullable: true`).
 * Both exist because OpenAI's strict mode requires them, so the shared schema
 * stays OpenAI-shaped and Gemini gets a translation.
 */
function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node === null || typeof node !== "object") return node;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((type) => type !== "null");
      out.type = types[0];
      if (types.length !== value.length) out.nullable = true;
      continue;
    }
    out[key] = toGeminiSchema(value);
  }
  return out;
}

/**
 * Gemini occasionally wraps JSON in a markdown fence despite
 * responseMimeType: application/json. Strip it before parsing.
 */
function stripCodeFence(text: string): string {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text.trim());
  return fenced ? fenced[1]! : text;
}

export const geminiProvider: AiProvider = {
  name: "gemini",

  isConfigured() {
    return Boolean(process.env.GEMINI_API_KEY);
  },

  async generateJson({ systemPrompt, userText, schema, image }: JsonRequest) {
    const parts: Record<string, unknown>[] = [{ text: userText }];
    if (image) {
      parts.push({ inline_data: { mime_type: image.mimeType, data: image.dataBase64 } });
    }
    const request = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: toGeminiSchema(schema),
      },
    };

    let text: string;
    try {
      text = await callGemini(request);
    } catch (error) {
      // Safety net: Gemini still rejects some schemas it considers too complex
      // with a 400. Retry once in plain JSON mode — Zod re-validates either
      // way, so correctness is unaffected; only the model's adherence is
      // weaker. Gated on 400 so permanent failures (retired model, outage)
      // don't pay for a second doomed round trip.
      if (error instanceof AiError && error.code === "PROVIDER_ERROR" && error.status === 400) {
        console.warn("[gemini] retrying without responseSchema");
        const generationConfig = { ...request.generationConfig };
        delete (generationConfig as { responseSchema?: unknown }).responseSchema;
        text = await callGemini({ ...request, generationConfig });
      } else {
        throw error;
      }
    }

    try {
      return JSON.parse(stripCodeFence(text));
    } catch {
      throw new AiError("The AI returned malformed JSON", "BAD_RESPONSE");
    }
  },

  async generateText({ systemPrompt, userText }: TextRequest) {
    return callGemini({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.3 },
    });
  },
};
