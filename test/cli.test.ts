import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { LIMITS, type JsonObject, type Report } from "../src/index";
import { api, fixture, nested, suite } from "./helpers";

function invoke(args: string[]): { status: number | null; text: string; report: Report } {
  const child = spawnSync(process.execPath, ["build/src/cli.js", ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 2 * LIMITS.documentBytes,
  });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  return { status: child.status, text: child.stdout, report: JSON.parse(child.stdout) as Report };
}

test("CLI has exit 0/1/2 and deterministic case ordering", () => {
  const accepted = invoke(["examples/api.json", "examples/valid-cases.json"]);
  assert.equal(accepted.status, 0);
  assert.deepEqual(accepted.report, { valid: true, cases_checked: 3, errors: [] });
  const rejected = invoke(["examples/api.json", "examples/invalid-cases.json"]);
  assert.equal(rejected.status, 1);
  assert.deepEqual(rejected.report.errors.map(error => error.case_id), ["a-missing", "b-type", "c-enum", "d-extra"]);
  assert.equal(rejected.text.includes("SYNTHETIC_PRIVATE_VALUE"), false);
  assert.equal(invoke([]).status, 2);
  assert.equal(invoke(["--help"]).report.errors[0]?.code, "usage.arguments");
  const directory = mkdtempSync(join(tmpdir(), "oec-order-"));
  try {
    const reversed = fixture("invalid-cases.json") as JsonObject;
    (reversed.cases as JsonObject[]).reverse();
    const path = join(directory, "suite.json");
    writeFileSync(path, JSON.stringify(reversed));
    assert.equal(invoke(["examples/api.json", path]).text, rejected.text);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI I/O and malformed-input reports never disclose filenames, raw errors or values", () => {
  const missing = invoke(["MISSING_FILENAME_SENTINEL.json", "examples/valid-cases.json"]);
  assert.equal(missing.status, 2);
  assert.deepEqual(missing.report, {
    valid: false, cases_checked: 0, errors: [{ instance_path: "", code: "io.read" }],
  });
  assert.equal(missing.text.includes("MISSING_FILENAME_SENTINEL"), false);
  const directory = mkdtempSync(join(tmpdir(), "oec-input-"));
  try {
    const path = join(directory, "input.json");
    writeFileSync(path, '{"PAYLOAD_SENTINEL":');
    const malformed = invoke([path, "examples/valid-cases.json"]);
    assert.equal(malformed.status, 2);
    assert.equal(malformed.report.errors[0]?.code, "config.json");
    assert.equal(malformed.text.includes("PAYLOAD_SENTINEL"), false);
    writeFileSync(path, Buffer.from([0xff]));
    assert.equal(invoke([path, "examples/valid-cases.json"]).report.errors[0]?.code, "config.json");
    assert.equal(invoke([directory, "examples/valid-cases.json"]).report.errors[0]?.code, "io.read");
    writeFileSync(path, JSON.stringify({ ...api(), openapi: "3.0.0" }));
    assert.equal(invoke([path, "examples/valid-cases.json"]).report.errors[0]?.code, "config.version");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI enforces inclusive file-byte bounds and reports case/payload limits as exit 2", () => {
  const directory = mkdtempSync(join(tmpdir(), "oec-limits-"));
  try {
    const apiPath = join(directory, "api.json");
    const suitePath = join(directory, "suite.json");
    const text = JSON.stringify(api());
    writeFileSync(apiPath, text + " ".repeat(LIMITS.documentBytes - Buffer.byteLength(text)));
    writeFileSync(suitePath, JSON.stringify(suite(null)));
    assert.equal(invoke([apiPath, suitePath]).status, 0);
    writeFileSync(apiPath, text + " ".repeat(LIMITS.documentBytes + 1 - Buffer.byteLength(text)));
    const over = invoke([apiPath, suitePath]);
    assert.equal(over.status, 2);
    assert.equal(over.report.errors[0]?.code, "limit.document_bytes");
    writeFileSync(apiPath, text);
    writeFileSync(suitePath, JSON.stringify(suite(nested(LIMITS.payloadDepth + 1))));
    assert.equal(invoke([apiPath, suitePath]).report.errors[0]?.code, "limit.payload_depth");
    writeFileSync(suitePath, JSON.stringify({ cases: Array.from({ length: LIMITS.cases + 1 }, (_, i) => ({
      id: `c${i}`, operationId: "op", kind: "request", payload: null,
    })) }));
    assert.equal(invoke([apiPath, suitePath]).report.errors[0]?.code, "limit.cases");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
