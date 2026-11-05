import { inspectDocument, inspectPayloadDepth, readJsonDocument } from "./json";
import { COMPONENT_NAME, prepareSchemas } from "./schemas";
import {
  CheckError, DIALECT, LIMITS, isObject, own,
  type CaseContext, type Diagnostic, type JsonObject, type JsonValue, type Report,
} from "./model";

export { CheckError, DIALECT, LIMITS, configurationReport } from "./model";
export type { CaseContext, Diagnostic, JsonObject, JsonValue, Report } from "./model";
export { parseJsonDocument } from "./json";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const STATUS = /^[1-5][0-9]{2}$/;
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
interface Case { context: CaseContext; payload: JsonValue }

function object(value: JsonValue | undefined, code: string): JsonObject {
  if (!isObject(value)) throw new CheckError(code);
  return value;
}
function identifier(value: JsonValue | undefined): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

function readCases(suite: JsonValue): Case[] {
  const root = object(suite, "config.suite");
  if (Object.keys(root).length !== 1 || !Array.isArray(root.cases)) throw new CheckError("config.suite");
  if (root.cases.length === 0) throw new CheckError("config.suite");
  if (root.cases.length > LIMITS.cases) throw new CheckError("limit.cases");
  const ids = new Set<string>();
  const result: Case[] = [];
  for (const raw of root.cases) {
    const item = object(raw, "config.case");
    if (!identifier(item.id) || !identifier(item.operationId) ||
        (item.kind !== "request" && item.kind !== "response") || !own(item, "payload")) {
      throw new CheckError("config.case");
    }
    const allowed = item.kind === "response"
      ? ["id", "operationId", "kind", "payload", "status"]
      : ["id", "operationId", "kind", "payload"];
    if (Object.keys(item).some(key => !allowed.includes(key))) throw new CheckError("config.case");
    if (item.kind === "response" && (typeof item.status !== "string" || !STATUS.test(item.status))) {
      throw new CheckError("config.case");
    }
    if (ids.has(item.id)) throw new CheckError("config.case_duplicate");
    ids.add(item.id);
    const context: CaseContext = { case_id: item.id, operationId: item.operationId, kind: item.kind };
    if (item.kind === "response") context.status = item.status as string;
    try { inspectPayloadDepth(item.payload!); }
    catch (error) {
      if (error instanceof CheckError) throw new CheckError(error.code, context);
      throw error;
    }
    result.push({ context, payload: item.payload! });
  }
  return result.sort((a, b) => a.context.case_id < b.context.case_id ? -1 : a.context.case_id > b.context.case_id ? 1 : 0);
}

function operations(api: JsonObject): Map<string, JsonObject> {
  const paths = object(api.paths, "config.paths");
  const result = new Map<string, JsonObject>();
  for (const path of Object.keys(paths).sort()) {
    if (!path.startsWith("/")) throw new CheckError("config.paths");
    const item = object(paths[path], "config.paths");
    if (own(item, "$ref")) throw new CheckError("config.reference");
    for (const method of METHODS) {
      if (!own(item, method)) continue;
      const operation = object(item[method], "config.operation");
      if (own(operation, "$ref")) throw new CheckError("config.reference");
      if (!identifier(operation.operationId)) throw new CheckError("config.operation_id");
      if (result.has(operation.operationId)) throw new CheckError("config.operation_ambiguous");
      result.set(operation.operationId, operation);
    }
  }
  return result;
}

function bodySchema(operation: JsonObject, context: CaseContext): JsonValue {
  let body: JsonObject;
  if (context.kind === "request") {
    body = object(operation.requestBody, "config.body");
  } else {
    const responses = object(operation.responses, "config.responses");
    if (!own(responses, context.status!)) throw new CheckError("config.status");
    body = object(responses[context.status!], "config.body");
  }
  if (own(body, "$ref")) throw new CheckError("config.reference");
  const content = object(body.content, "config.content");
  if (Object.keys(content).length !== 1 || !own(content, "application/json")) {
    throw new CheckError("config.media_type");
  }
  const media = object(content["application/json"], "config.content");
  if (own(media, "$ref")) throw new CheckError("config.reference");
  if (!own(media, "schema")) throw new CheckError("config.schema_missing");
  return media.schema!;
}

/** Validate explicit case payloads; configuration failures throw CheckError. */
export function checkDocuments(openapi: unknown, suite: unknown): Report {
  inspectDocument(openapi);
  inspectDocument(suite);
  const api = object(openapi, "config.document");
  if (api.openapi !== "3.1.1") throw new CheckError("config.version");
  if (own(api, "jsonSchemaDialect") && api.jsonSchemaDialect !== DIALECT) throw new CheckError("config.dialect");
  const cases = readCases(suite);
  const indexed = operations(api);
  const components = new Map<string, JsonValue>();
  if (own(api, "components")) {
    const container = object(api.components, "config.components");
    if (own(container, "schemas")) {
      const schemas = object(container.schemas, "config.components");
      for (const name of Object.keys(schemas).sort()) {
        if (!COMPONENT_NAME.test(name)) throw new CheckError("config.component_name");
        components.set(name, schemas[name]!);
      }
    }
  }
  const entries = new Map<string, JsonValue>();
  const selections = new Map<string, string>();
  const caseEntries = new Map<string, string>();
  for (const item of cases) {
    const context = item.context;
    const selection = `${context.operationId}/${context.kind}/${context.status ?? ""}`;
    let entry = selections.get(selection);
    if (!entry) {
      const operation = indexed.get(context.operationId);
      if (!operation) throw new CheckError("config.operation_missing", context);
      entry = `$entry_${entries.size}`;
      try { entries.set(entry, bodySchema(operation, context)); }
      catch (error) {
        if (error instanceof CheckError) throw new CheckError(error.code, context);
        throw error;
      }
      selections.set(selection, entry);
    }
    caseEntries.set(context.case_id, entry);
  }
  const validators = prepareSchemas(components, entries);
  const errors: Diagnostic[] = [];
  for (const item of cases) {
    const validator = validators.get(caseEntries.get(item.context.case_id)!)!;
    if (!validator(item.payload)) {
      const failure = validator.errors?.[0];
      const keyword = failure?.keyword ?? "validation";
      errors.push({
        ...item.context,
        instance_path: failure?.instancePath ?? "",
        code: keyword === "false schema" ? "false_schema" : keyword,
      });
    }
  }
  return { valid: errors.length === 0, cases_checked: cases.length, errors };
}

export async function checkFiles(openapiPath: string, suitePath: string): Promise<Report> {
  const api = await readJsonDocument(openapiPath);
  const suite = await readJsonDocument(suitePath);
  return checkDocuments(api, suite);
}
