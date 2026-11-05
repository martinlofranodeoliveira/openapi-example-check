import test, { mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import {
  checkDocuments, configurationReport, parseJsonDocument, LIMITS, type JsonObject, type JsonValue,
} from "../src/index";
import { api, expectCode, nested, operation, suite } from "./helpers";

test("local references and guarded recursive schemas validate finite payloads", () => {
  const document = api({ $ref: "#/components/schemas/Node" });
  document.components = { schemas: { Node: {
    type: "object", required: ["value"], properties: {
      value: { type: "integer" }, next: { $ref: "#/components/schemas/Node" },
    }, additionalProperties: false,
  } } };
  assert.equal(checkDocuments(document, suite({ value: 1, next: { value: 2 } })).valid, true);
  const report = checkDocuments(document, suite({ value: 1, next: { value: "NO_ECHO" } }));
  assert.equal(report.errors[0]?.instance_path, "/next/value");
  assert.equal(report.errors[0]?.code, "type");
  assert.equal(JSON.stringify(report).includes("NO_ECHO"), false);
});

test("reference grammar, resolution, names and non-progress cycles fail closed", () => {
  for (const reference of [
    "https://invalid.example/schema", "file:///synthetic.json", "other.json#/A",
    "#/$defs/A", "#/components/schemas/A/properties/x", "#/components/schemas/%41",
  ]) expectCode(() => checkDocuments(api({ $ref: reference }), suite(null)), "config.reference");
  expectCode(() => checkDocuments(api({ $ref: "#/components/schemas/Absent" }), suite(null)), "config.reference_missing");
  const badName = api();
  badName.components = { schemas: { "not-a-component": true } };
  expectCode(() => checkDocuments(badName, suite(null)), "config.component_name");
  const cyclic = api({ $ref: "#/components/schemas/A" });
  cyclic.components = { schemas: {
    A: { $ref: "#/components/schemas/B" }, B: { $ref: "#/components/schemas/A" },
  } };
  expectCode(() => checkDocuments(cyclic, suite(null)), "config.reference_cycle");
});

test("remote references fail before any fetch and embedded external examples are never fetched", () => {
  const unexpectedNetwork = (): never => { throw new Error("unexpected network operation"); };
  const spies = [
    mock.method(http, "request", unexpectedNetwork), mock.method(http, "get", unexpectedNetwork),
    mock.method(https, "request", unexpectedNetwork), mock.method(https, "get", unexpectedNetwork),
    mock.method(globalThis, "fetch", unexpectedNetwork),
  ];
  try {
    expectCode(() => checkDocuments(api({ $ref: "https://invalid.example/private-schema" }), suite(null)), "config.reference");
    const unused = api();
    unused.components = { schemas: { Unused: { $ref: "http://invalid.example/unused" } } };
    expectCode(() => checkDocuments(unused, suite(null)), "config.reference");
    const document = api({ type: "integer" });
    const body = operation(document).requestBody as JsonObject;
    const content = body.content as JsonObject;
    const media = content["application/json"] as JsonObject;
    media.examples = { synthetic: { externalValue: "https://invalid.example/private-example" } };
    assert.equal(checkDocuments(document, suite(7)).valid, true);
    for (const spy of spies) assert.equal(spy.mock.callCount(), 0);
  } finally {
    for (const spy of spies) spy.mock.restore();
  }
});

test("local reference siblings retain constraints and do not rewrite caller documents", () => {
  const document = api({ $ref: "#/components/schemas/Count", type: "integer", maximum: 3 });
  document.components = { schemas: { Count: { type: "integer", minimum: 1 } } };
  const before = JSON.stringify(document);
  assert.equal(checkDocuments(document, suite(2)).valid, true);
  assert.equal(checkDocuments(document, suite(0)).errors[0]?.code, "minimum");
  assert.equal(checkDocuments(document, suite(4)).errors[0]?.code, "maximum");
  assert.equal(JSON.stringify(document), before);
});

test("schema and payload values never leak through validation or configuration diagnostics", () => {
  const report = checkDocuments(api({ type: "string", enum: ["SCHEMA_ENUM_SENTINEL"] }), suite("PAYLOAD_VALUE_SENTINEL"));
  assert.equal(report.errors[0]?.code, "enum");
  assert.equal(JSON.stringify(report).includes("SCHEMA_ENUM_SENTINEL"), false);
  assert.equal(JSON.stringify(report).includes("PAYLOAD_VALUE_SENTINEL"), false);
  try {
    checkDocuments(api({ type: "object", required: ["SCHEMA_REQUIRED_SENTINEL"], properties: {} }), suite({}));
    assert.fail("strictRequired must reject the malformed schema");
  } catch (error) {
    const diagnostic = configurationReport(error);
    assert.equal(diagnostic.errors[0]?.code, "config.schema");
    assert.equal(JSON.stringify(diagnostic).includes("SCHEMA_REQUIRED_SENTINEL"), false);
  }
});

test("version, dialect and strict malformed-schema handling", () => {
  const version = api();
  version.openapi = "3.1.0";
  expectCode(() => checkDocuments(version, suite(null)), "config.version");
  const dialect = api();
  dialect.jsonSchemaDialect = "https://spec.openapis.org/oas/3.1/dialect/base";
  expectCode(() => checkDocuments(dialect, suite(null)), "config.dialect");
  expectCode(() => checkDocuments(api({ $schema: "http://json-schema.org/draft-07/schema#" }), suite(null)), "config.dialect");
  for (const malformed of [
    { type: "potato" }, { type: "object", required: "name" },
    { type: "string", minLength: -1 }, { properties: { x: { type: "string" } } },
    { type: "object", required: ["missing"], properties: {} },
    { type: "object", additionalProperties: { type: "string" } },
    { enum: [{ value: 1 }] }, { const: [1] },
  ]) expectCode(() => checkDocuments(api(malformed), suite(null)), "config.schema");
  expectCode(() => checkDocuments(api({ type: "string", format: "email" }), suite(null)), "config.format");
  for (const unsupported of [{ pattern: "a+" }, { allOf: [true] }, { $id: "urn:synthetic" }, { nullable: true }]) {
    expectCode(() => checkDocuments(api(unsupported), suite(null)), "config.schema_keyword");
  }
  const unused = api();
  unused.components = { schemas: { Unused: { type: "string", minLength: -1 } } };
  expectCode(() => checkDocuments(unused, suite(null)), "config.schema");
});

test("operation IDs are unique and must resolve, even if another operation is unused", () => {
  const document = api();
  (document.paths as JsonObject)["/another"] = { get: { operationId: "op" } };
  expectCode(() => checkDocuments(document, suite(null)), "config.operation_ambiguous");
  const missing = suite(null);
  (missing.cases as JsonObject[])[0]!.operationId = "absent";
  expectCode(() => checkDocuments(api(), missing), "config.operation_missing");
  const unnamed = api();
  delete operation(unnamed).operationId;
  expectCode(() => checkDocuments(unnamed, suite(null)), "config.operation_id");
});

test("selection failures never fall back to default or wildcard statuses", () => {
  const document = api();
  operation(document).responses = { default: { content: { "application/json": { schema: true } } }, "2XX": {} };
  expectCode(() => checkDocuments(document, suite(null, "response")), "config.status");
  const noResponses = api();
  delete operation(noResponses).responses;
  expectCode(() => checkDocuments(noResponses, suite(null, "response")), "config.responses");
  const missingBody = api();
  delete operation(missingBody).requestBody;
  expectCode(() => checkDocuments(missingBody, suite(null)), "config.body");
  const variants: [JsonValue, string][] = [
    [{}, "config.content"],
    [{ $ref: "#/components/requestBodies/X" }, "config.reference"],
    [{ content: { "text/plain": { schema: true } } }, "config.media_type"],
    [{ content: { "application/json": { schema: true }, "text/plain": {} } }, "config.media_type"],
    [{ content: { "application/json; charset=utf-8": { schema: true } } }, "config.media_type"],
    [{ content: { "application/json": {} } }, "config.schema_missing"],
  ];
  for (const [body, code] of variants) {
    const candidate = api();
    operation(candidate).requestBody = body;
    expectCode(() => checkDocuments(candidate, suite(null)), code);
  }
});

test("suite contract rejects duplicates, extra fields and invalid statuses", () => {
  const item = { id: "same", operationId: "op", kind: "request", payload: null };
  expectCode(() => checkDocuments(api(), { cases: [item, item] }), "config.json");
  expectCode(() => checkDocuments(api(), { cases: [item, { ...item }] }), "config.case_duplicate");
  expectCode(() => checkDocuments(api(), { cases: [] }), "config.suite");
  for (const invalid of [
    { ...item, status: "200" }, { ...item, kind: "response" },
    { ...item, kind: "response", status: "2XX" }, { ...item, extra: true },
    { id: "x", operationId: "op", kind: "request" },
  ]) expectCode(() => checkDocuments(api(), { cases: [invalid] }), "config.case");
});

test("exact byte, node and document-depth boundaries", () => {
  assert.equal(parseJsonDocument(" ".repeat(LIMITS.documentBytes - 4) + "null"), null);
  expectCode(() => parseJsonDocument(" ".repeat(LIMITS.documentBytes - 3) + "null"), "limit.document_bytes");
  assert.doesNotThrow(() => parseJsonDocument(JSON.stringify(nested(LIMITS.documentDepth))));
  expectCode(() => parseJsonDocument(JSON.stringify(nested(LIMITS.documentDepth + 1))), "limit.document_depth");
  assert.doesNotThrow(() => parseJsonDocument(JSON.stringify(Array(LIMITS.documentNodes - 1).fill(null))));
  expectCode(() => parseJsonDocument(JSON.stringify(Array(LIMITS.documentNodes).fill(null))), "limit.document_nodes");
  expectCode(() => parseJsonDocument("1e400"), "config.json");
  expectCode(() => parseJsonDocument("{"), "config.json");
});

test("exact payload-depth and case-count boundaries", () => {
  assert.equal(checkDocuments(api(), suite(nested(LIMITS.payloadDepth))).valid, true);
  expectCode(() => checkDocuments(api(), suite(nested(LIMITS.payloadDepth + 1))), "limit.payload_depth");
  function many(count: number): JsonObject {
    return { cases: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, operationId: "op", kind: "request", payload: null })) };
  }
  assert.equal(checkDocuments(api(), many(LIMITS.cases)).cases_checked, LIMITS.cases);
  expectCode(() => checkDocuments(api(), many(LIMITS.cases + 1)), "limit.cases");
});

test("exact schema-node, reference-count and enum boundaries", () => {
  function components(count: number, recursive: boolean): JsonObject {
    const document = api();
    const schemas: JsonObject = {};
    for (let i = 0; i < count; i++) schemas[`C${i}`] = recursive
      ? { type: "object", properties: { next: { $ref: `#/components/schemas/C${i}` } } }
      : true;
    document.components = { schemas };
    return document;
  }
  assert.equal(checkDocuments(components(LIMITS.schemaNodes - 1, false), suite(null)).valid, true);
  expectCode(() => checkDocuments(components(LIMITS.schemaNodes, false), suite(null)), "limit.schema_nodes");
  assert.equal(checkDocuments(components(LIMITS.references, true), suite(null)).valid, true);
  expectCode(() => checkDocuments(components(LIMITS.references + 1, true), suite(null)), "limit.references");
  const values = Array.from({ length: LIMITS.enumValues }, (_, i) => i);
  assert.equal(checkDocuments(api({ enum: values }), suite(0)).valid, true);
  expectCode(() => checkDocuments(api({ enum: [...values, LIMITS.enumValues] }), suite(0)), "limit.enum_values");
});

test("exact reference depth and bounded expansion work", () => {
  function chain(count: number, branching = false): JsonObject {
    const schemas: JsonObject = {};
    for (let i = 0; i < count; i++) {
      const ref = { $ref: `#/components/schemas/C${i + 1}` };
      schemas[`C${i}`] = i === count - 1 ? true : branching
        ? { type: "object", properties: { a: ref, b: { ...ref } } }
        : ref;
    }
    const document = api({ $ref: "#/components/schemas/C0" });
    document.components = { schemas };
    return document;
  }
  assert.equal(checkDocuments(chain(LIMITS.referenceDepth), suite(null)).valid, true);
  expectCode(() => checkDocuments(chain(LIMITS.referenceDepth + 1), suite(null)), "limit.reference_depth");
  assert.equal(checkDocuments(chain(10, true), suite({})).valid, true);
  expectCode(() => checkDocuments(chain(11, true), suite({})), "limit.reference_visits");
});

test("in-memory API rejects cycles, accessors, sparse arrays and dangerous schema properties", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  expectCode(() => checkDocuments(api(), cycle), "config.json");
  let called = false;
  const accessor = Object.defineProperty({}, "cases", { enumerable: true, get() { called = true; return []; } });
  expectCode(() => checkDocuments(api(), accessor), "config.json");
  assert.equal(called, false);
  expectCode(() => checkDocuments(api(), { cases: Array(1) }), "config.json");
  const schema = JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}') as JsonValue;
  expectCode(() => checkDocuments(api(schema), suite({})), "config.schema_property");
  const repeated = { value: 1 };
  const repeatedDocument = api();
  repeatedDocument["x-first"] = repeated;
  repeatedDocument["x-second"] = repeated;
  expectCode(() => checkDocuments(repeatedDocument, suite(null)), "config.json");
});
