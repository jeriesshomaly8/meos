export type AiErrorCode =
  | "NOT_CONFIGURED"
  /** Key works, but the configured model id doesn't exist for it. */
  | "MODEL_UNAVAILABLE"
  | "QUOTA_EXCEEDED"
  | "PROVIDER_ERROR"
  | "BAD_RESPONSE";

export class AiError extends Error {
  constructor(
    message: string,
    public readonly code: AiErrorCode,
    /** Provider HTTP status, when there was one. Lets callers tell apart
     *  failures that share a code but need different handling (a rejected
     *  schema is retryable, a retired model is not). */
    public readonly status?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface JsonRequest {
  systemPrompt: string;
  userText: string;
  /**
   * JSON Schema the response must satisfy. Kept to the subset both Gemini and
   * OpenAI accept: type/properties/required/additionalProperties/items/enum/
   * anyOf, and nullability via `type: ["string", "null"]`.
   */
  schema: Record<string, unknown>;
  /** Provider-facing name for the schema; OpenAI requires one. */
  schemaName: string;
  /**
   * A photo accompanying the text (photo capture). Read once by the model to
   * understand it, never persisted anywhere.
   */
  image?: { mimeType: string; dataBase64: string };
}

export interface TextRequest {
  systemPrompt: string;
  userText: string;
}

/** Minimal surface both providers implement. */
export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  generateJson(request: JsonRequest): Promise<unknown>;
  generateText(request: TextRequest): Promise<string>;
}
