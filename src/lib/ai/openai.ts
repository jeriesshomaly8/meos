import OpenAI from "openai";
import { AiError, type AiProvider, type JsonRequest, type TextRequest } from "./types";

/**
 * Optional paid provider. Enable with AI_PROVIDER=openai.
 * Kept alongside Gemini because the free tier's daily quota is small and
 * Google adjusts it, so a paid fallback is a real operational need.
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const TIMEOUT_MS = 45_000;

function client(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiError("OPENAI_API_KEY is not set", "NOT_CONFIGURED");
  }
  return new OpenAI({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
}

async function complete(
  systemPrompt: string,
  userText: string,
  responseFormat?: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"],
): Promise<string> {
  let completion;
  try {
    completion = await client().chat.completions.create({
      model: process.env.OPENAI_MODEL ?? DEFAULT_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
      response_format: responseFormat,
      temperature: 0.2,
    });
  } catch (error) {
    if (error instanceof AiError) throw error;
    const status = (error as { status?: number }).status;
    console.error("[openai] request failed:", error instanceof Error ? error.message : error);
    if (status === 429) {
      throw new AiError("OpenAI quota or rate limit reached", "QUOTA_EXCEEDED");
    }
    throw new AiError("The AI service returned an error", "PROVIDER_ERROR");
  }

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new AiError("The AI returned an empty response", "BAD_RESPONSE");
  }
  return text;
}

export const openAiProvider: AiProvider = {
  name: "openai",

  isConfigured() {
    return Boolean(process.env.OPENAI_API_KEY);
  },

  async generateJson({ systemPrompt, userText, schema, schemaName, image }: JsonRequest) {
    if (image) {
      // Honest refusal beats silently analyzing the caption alone: the user
      // attached a photo because the photo IS the content.
      throw new AiError("Photo capture needs the Gemini provider", "NOT_CONFIGURED");
    }
    const text = await complete(systemPrompt, userText, {
      type: "json_schema",
      json_schema: { name: schemaName, strict: true, schema },
    } as OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"]);
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError("The AI returned malformed JSON", "BAD_RESPONSE");
    }
  },

  async generateText({ systemPrompt, userText }: TextRequest) {
    return complete(systemPrompt, userText);
  },
};
