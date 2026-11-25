import { geminiProvider } from "./gemini";
import { openAiProvider } from "./openai";
import type { AiProvider } from "./types";

export { AiError } from "./types";
export type { AiErrorCode, AiProvider } from "./types";

/**
 * Gemini is the default because it has a genuinely free tier.
 * Set AI_PROVIDER=openai to use the paid provider instead.
 */
export function aiProvider(): AiProvider {
  return process.env.AI_PROVIDER === "openai" ? openAiProvider : geminiProvider;
}

export function isAiConfigured(): boolean {
  return aiProvider().isConfigured();
}

/**
 * Copy shown when no provider key is present. Everything except the AI inbox
 * and Ask MeOS works without one, so this is a nudge, not a dead end.
 */
export const AI_NOT_CONFIGURED_MESSAGE =
  "AI features aren't set up yet. Get a free key at aistudio.google.com/apikey and add it to .env.local as GEMINI_API_KEY — the rest of MeOS works without it.";

/**
 * Distinct from the above: the key is fine, the model id isn't. Google retires
 * model ids for new keys, so this is a config fix, not a transient outage —
 * telling the user to "try again in a moment" would be a lie.
 */
export const AI_MODEL_UNAVAILABLE_MESSAGE =
  "The configured AI model isn't available for this API key. Set GEMINI_MODEL in .env.local to a current model (gemini-flash-latest works).";
