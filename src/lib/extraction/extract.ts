import { aiProvider } from "@/lib/ai";
import { EXTRACTION_JSON_SCHEMA } from "./json-schema";
import { buildExtractionPrompt } from "./prompt";
import { parseExtractionResponse, type ExtractedItem } from "./schema";

/**
 * Server-only extraction. The provider key never reaches the client, and only
 * the text the user explicitly submitted is sent to the AI provider.
 */

const MAX_INPUT_CHARS = 4_000;

export async function extractItems(
  text: string,
  timezone: string,
  now: Date = new Date(),
  image?: { mimeType: string; dataBase64: string },
): Promise<{ items: ExtractedItem[]; droppedCount: number }> {
  const raw = await aiProvider().generateJson({
    systemPrompt: buildExtractionPrompt(timezone, now, { hasImage: Boolean(image) }),
    userText: text.slice(0, MAX_INPUT_CHARS) || "(no typed text — read the photo)",
    schema: EXTRACTION_JSON_SCHEMA.schema,
    schemaName: EXTRACTION_JSON_SCHEMA.name,
    image,
  });

  return parseExtractionResponse(raw);
}
