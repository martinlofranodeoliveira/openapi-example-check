import test from "node:test";
import assert from "node:assert/strict";
import { checkDocuments, type JsonObject, type JsonValue } from "../src/index";
import { api, fixture, operation, suite } from "./helpers";

test("synthetic fixture outcomes are independently specified", () => {
  assert.deepEqual(checkDocuments(fixture("api.json"), fixture("valid-cases.json")), {
    valid: true, cases_checked: 3, errors: [],
  });
  assert.deepEqual(checkDocuments(fixture("api.json"), fixture("invalid-cases.json")), {
    valid: false,
    cases_checked: 4,
    errors: [
      { case_id: "a-missing", operationId: "createOrder", kind: "request", instance_path: "", code: "required" },
      { case_id: "b-type", operationId: "createOrder", kind: "request", instance_path: "/items/0/quantity", code: "type" },
      { case_id: "c-enum", operationId: "getOrder", kind: "response", status: "200", instance_path: "/state", code: "enum" },
      { case_id: "d-extra", operationId: "createOrder", kind: "response", status: "201", instance_path: "", code: "additionalProperties" },
    ],
  });
});

test("request and exact response selections use different schemas", () => {
  const document = api({ type: "integer" });
  operation(document).responses = {
    "200": { content: { "application/json": { schema: { type: "string" } } } },
    "201": { content: { "application/json": { schema: { type: "boolean" } } } },
  };
  const cases = { cases: [
    { id: "a", operationId: "op", kind: "request", payload: 7 },
    { id: "b", operationId: "op", kind: "response", status: "200", payload: "synthetic" },
    { id: "c", operationId: "op", kind: "response", status: "201", payload: true },
  ] };
  assert.equal(checkDocuments(document, cases).valid, true);
  const wrong = checkDocuments(document, suite(7, "response"));
  assert.equal(wrong.errors[0]?.code, "type");
});

const schema: JsonObject = {
  type: "object",
  required: ["name", "mode", "lines"],
  properties: {
    name: { type: "string" },
    mode: { type: "string", enum: ["x", "y"] },
    lines: { type: "array", minItems: 1, items: {
      type: "object", required: ["n"], properties: { n: { type: "integer" } }, additionalProperties: false,
    } },
    count: { type: "integer", default: 9, readOnly: true },
    secret: { type: "string", writeOnly: true },
  },
  additionalProperties: false,
};
function good(): JsonObject { return { name: "synthetic", mode: "x", lines: [{ n: 1 }] }; }

const failures: { label: string; change: (value: JsonObject) => void; code: string; path: string }[] = [
  { label: "required", change: v => { delete v.name; }, code: "required", path: "" },
  { label: "wrong type", change: v => { v.name = false; }, code: "type", path: "/name" },
  { label: "enum", change: v => { v.mode = "not-an-enum-member"; }, code: "enum", path: "/mode" },
  { label: "array type", change: v => { v.lines = "not-an-array"; }, code: "type", path: "/lines" },
  { label: "array minimum", change: v => { v.lines = []; }, code: "minItems", path: "/lines" },
  { label: "array item", change: v => { v.lines = [false]; }, code: "type", path: "/lines/0" },
  { label: "nested required", change: v => { v.lines = [{}]; }, code: "required", path: "/lines/0" },
  { label: "nested no coercion", change: v => { v.lines = [{ n: "1" }]; }, code: "type", path: "/lines/0/n" },
  { label: "integer", change: v => { v.lines = [{ n: 1.5 }]; }, code: "type", path: "/lines/0/n" },
  { label: "additional field", change: v => { v.extra = "PAYLOAD_SENTINEL"; }, code: "additionalProperties", path: "" },
];
for (const expected of failures) {
  test(`public API: ${expected.label}`, () => {
    const payload = good();
    expected.change(payload);
    const report = checkDocuments(api(schema), suite(payload));
    assert.equal(report.valid, false);
    assert.equal(report.cases_checked, 1);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0]?.code, expected.code);
    assert.equal(report.errors[0]?.instance_path, expected.path);
    assert.equal(JSON.stringify(report).includes("PAYLOAD_SENTINEL"), false);
  });
}

test("validation never inserts defaults, removes fields or coerces values", () => {
  const payload = good();
  const before = JSON.stringify(payload);
  assert.equal(checkDocuments(api(schema), suite(payload)).valid, true);
  assert.equal(JSON.stringify(payload), before);
  assert.equal(Object.hasOwn(payload, "count"), false);
  const input = suite("7");
  assert.equal(checkDocuments(api({ type: "integer" }), input).errors[0]?.code, "type");
  assert.equal((input.cases as JsonObject[])[0]?.payload, "7");
});

test("readOnly/writeOnly are annotations in both directions, but types still apply", () => {
  for (const kind of ["request", "response"] as const) {
    const payload = { ...good(), count: 2, secret: "synthetic" };
    assert.equal(checkDocuments(api(schema), suite(payload, kind)).valid, true);
    assert.equal(checkDocuments(api(schema), suite({ ...payload, count: "2" }, kind)).errors[0]?.code, "type");
  }
});

test("escaped JSON pointer paths remain useful without error parameters", () => {
  const document = api({ type: "object", properties: { "a/b~c": { type: "integer" } } });
  const report = checkDocuments(document, suite({ "a/b~c": "VALUE_SENTINEL" }));
  assert.equal(report.errors[0]?.instance_path, "/a~1b~0c");
  assert.equal(JSON.stringify(report).includes("VALUE_SENTINEL"), false);
});

test("boolean schemas and primitive constraints use Ajv", () => {
  assert.equal(checkDocuments(api(true), suite(null)).valid, true);
  assert.equal(checkDocuments(api(false), suite(null)).errors[0]?.code, "false_schema");
  const examples: [JsonValue, JsonValue, string][] = [
    [{ type: "number", minimum: 2 }, 1, "minimum"],
    [{ type: "string", maxLength: 2 }, "abc", "maxLength"],
    [{ const: "synthetic" }, "other", "const"],
    [{ type: "array", items: true, maxItems: 1 }, [1, 2], "maxItems"],
  ];
  for (const [selected, payload, keyword] of examples) {
    assert.equal(checkDocuments(api(selected), suite(payload)).errors[0]?.code, keyword);
  }
});
