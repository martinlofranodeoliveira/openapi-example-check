import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CheckError, parseJsonDocument, type JsonObject, type JsonValue } from "../src/index";

export function api(schema: JsonValue = true): JsonObject {
  return {
    openapi: "3.1.1",
    info: { title: "Synthetic test", version: "0" },
    paths: {
      "/synthetic": {
        post: {
          operationId: "op",
          requestBody: { content: { "application/json": { schema: structuredClone(schema) } } },
          responses: { "200": { description: "Synthetic", content: { "application/json": { schema: structuredClone(schema) } } } },
        },
      },
    },
  };
}
export function operation(document: JsonObject): JsonObject {
  return ((document.paths as JsonObject)["/synthetic"] as JsonObject).post as JsonObject;
}
export function suite(payload: JsonValue, kind: "request" | "response" = "request"): JsonObject {
  const item: JsonObject = { id: "case", operationId: "op", kind, payload };
  if (kind === "response") item.status = "200";
  return { cases: [item] };
}
export function expectCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof CheckError && error.code === code);
}
export function fixture(name: string): JsonValue {
  return parseJsonDocument(readFileSync(`examples/${name}`, "utf8"));
}
export function nested(depth: number): JsonValue {
  let value: JsonValue = null;
  for (let i = 0; i < depth; i++) value = [value];
  return value;
}
