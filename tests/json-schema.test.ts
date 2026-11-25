import { describe, expect, it } from "vitest";
import { EXTRACTION_JSON_SCHEMA } from "@/lib/extraction/json-schema";
import { extractedItemSchema } from "@/lib/extraction/schema";

/**
 * The response schema is sent to whichever provider is configured, and Gemini
 * and OpenAI accept overlapping-but-different JSON Schema subsets. These tests
 * pin the intersection so a future edit can't silently introduce a keyword one
 * provider rejects at request time — a failure that would otherwise only show
 * up as a 400 in production.
 */

type Node = Record<string, unknown>;

function walk(node: unknown, visit: (node: Node, path: string) => void, path = "$"): void {
  if (Array.isArray(node)) {
    node.forEach((child, index) => walk(child, visit, `${path}[${index}]`));
    return;
  }
  if (node === null || typeof node !== "object") return;

  const current = node as Node;
  visit(current, path);
  for (const [key, value] of Object.entries(current)) {
    walk(value, visit, `${path}.${key}`);
  }
}

const UNSUPPORTED_KEYWORDS = [
  "allOf",
  "oneOf",
  "not",
  "patternProperties",
  "dependentSchemas",
  "if",
  "then",
  "else",
  "const",
  "$defs",
  "definitions",
];

describe("extraction JSON schema portability", () => {
  const schema = EXTRACTION_JSON_SCHEMA.schema as unknown as Node;

  it("uses no keywords outside the shared provider subset", () => {
    const found: string[] = [];
    walk(schema, (node, path) => {
      for (const keyword of UNSUPPORTED_KEYWORDS) {
        if (keyword in node) found.push(`${path}.${keyword}`);
      }
    });
    expect(found).toEqual([]);
  });

  it("expresses nullability as a type union, not a `nullable` flag", () => {
    const nullableFlags: string[] = [];
    walk(schema, (node, path) => {
      if ("nullable" in node) nullableFlags.push(path);
    });
    expect(nullableFlags).toEqual([]);
  });

  it("marks every object property required (OpenAI strict mode)", () => {
    const violations: string[] = [];
    walk(schema, (node, path) => {
      if (node.type !== "object" || !node.properties) return;
      const properties = Object.keys(node.properties as Node);
      const required = (node.required as string[] | undefined) ?? [];
      const missing = properties.filter((key) => !required.includes(key));
      if (missing.length > 0) violations.push(`${path}: ${missing.join(", ")}`);
    });
    expect(violations).toEqual([]);
  });

  it("closes every object with additionalProperties: false", () => {
    const open: string[] = [];
    walk(schema, (node, path) => {
      if (node.type === "object" && node.properties && node.additionalProperties !== false) {
        open.push(path);
      }
    });
    expect(open).toEqual([]);
  });

  /*
   * The point is that the JSON schema and the Zod union stay in step, so the
   * expectation is read off the Zod union rather than written out again here.
   * A hardcoded list was a third copy of the category set — the same drift this
   * test exists to catch.
   */
  it("covers every extraction category as an anyOf variant", () => {
    const items = (schema.properties as Node).items as Node;
    const variants = (items.items as Node).anyOf as Node[];
    const categories = variants
      .map((variant) => {
        const category = (variant.properties as Node).category as Node;
        return (category.enum as string[])[0];
      })
      .sort();

    const fromZod = extractedItemSchema.options
      .map((option) => option.shape.category.value as string)
      .sort();

    expect(fromZod.length).toBeGreaterThan(0);
    expect(categories).toEqual(fromZod);
  });
});
