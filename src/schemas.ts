import Ajv2020 from "ajv/dist/2020";
import type { ValidateFunction } from "ajv";
import { CheckError, DIALECT, LIMITS, isObject, type JsonValue } from "./model";

const REGISTRY = "urn:lofrano:openapi-example-check:schemas";
export const COMPONENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const REF = /^#\/components\/schemas\/([A-Za-z][A-Za-z0-9_]{0,63})$/;
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const KEYWORDS = new Set([
  "$schema", "$ref", "type", "properties", "required", "additionalProperties", "items",
  "minItems", "maxItems", "minLength", "maxLength", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "enum", "const",
  "title", "description", "default", "readOnly", "writeOnly",
]);
const UNSAFE_PROPERTIES = new Set(["__proto__", "prototype", "constructor"]);
interface Edge { target: string; guarded: boolean }

function primitive(value: JsonValue): boolean {
  return value === null || typeof value !== "object";
}

export function prepareSchemas(
  components: Map<string, JsonValue>,
  entries: Map<string, JsonValue>,
): Map<string, ValidateFunction> {
  let nodes = 0;
  let references = 0;
  const edges = new Map<string, Edge[]>();
  const definitions: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  const sources = new Map([...components, ...entries]);
  for (const key of sources.keys()) edges.set(key, []);

  function rewrite(schema: JsonValue, owner: string, guarded: boolean): JsonValue {
    if (++nodes > LIMITS.schemaNodes) throw new CheckError("limit.schema_nodes");
    if (typeof schema === "boolean") return schema;
    if (!isObject(schema)) throw new CheckError("config.schema");
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Object.keys(schema).sort()) {
      const value = schema[key]!;
      if (key === "format") throw new CheckError("config.format");
      if (!KEYWORDS.has(key)) throw new CheckError("config.schema_keyword");
      if (key === "$schema") {
        if (value !== DIALECT) throw new CheckError("config.dialect");
        result[key] = value;
      } else if (key === "$ref") {
        const match = typeof value === "string" ? REF.exec(value) : null;
        if (!match) throw new CheckError("config.reference");
        const target = match[1]!;
        if (!components.has(target)) throw new CheckError("config.reference_missing");
        if (++references > LIMITS.references) throw new CheckError("limit.references");
        edges.get(owner)!.push({ target, guarded });
        result[key] = `${REGISTRY}#/$defs/${target}`;
      } else if (key === "properties") {
        if (!isObject(value)) throw new CheckError("config.schema");
        const properties: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
        for (const name of Object.keys(value).sort()) {
          if (name.length > 64 || UNSAFE_PROPERTIES.has(name)) throw new CheckError("config.schema_property");
          properties[name] = rewrite(value[name]!, owner, true);
        }
        result[key] = properties;
      } else if (key === "items") {
        result[key] = rewrite(value, owner, true);
      } else if (key === "additionalProperties") {
        if (typeof value !== "boolean") throw new CheckError("config.schema");
        result[key] = value;
      } else if (key === "type") {
        if (typeof value !== "string" || !TYPES.has(value)) throw new CheckError("config.schema");
        result[key] = value;
      } else if (key === "enum") {
        if (!Array.isArray(value) || value.length === 0 || !value.every(primitive)) {
          throw new CheckError("config.schema");
        }
        if (value.length > LIMITS.enumValues) throw new CheckError("limit.enum_values");
        result[key] = value;
      } else if (key === "const") {
        if (!primitive(value)) throw new CheckError("config.schema");
        result[key] = value;
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  for (const [name, schema] of sources) definitions[name] = rewrite(schema, name, false);

  // Reject cycles that can recurse without consuming a property or array item.
  const complete = new Set<string>();
  const active = new Set<string>();
  function unguarded(name: string): void {
    if (active.has(name)) throw new CheckError("config.reference_cycle");
    if (complete.has(name)) return;
    active.add(name);
    for (const edge of edges.get(name)!) if (!edge.guarded) unguarded(edge.target);
    active.delete(name);
    complete.add(name);
  }
  for (const name of sources.keys()) unguarded(name);

  // Bound expansion before compilation, stopping a branch at a repeated name.
  let visits = 0;
  function visit(target: string, chain: readonly string[]): void {
    if (++visits > LIMITS.referenceVisits) throw new CheckError("limit.reference_visits");
    if (chain.includes(target)) return;
    if (chain.length >= LIMITS.referenceDepth) throw new CheckError("limit.reference_depth");
    const next = [...chain, target];
    for (const edge of edges.get(target)!) visit(edge.target, next);
  }
  for (const name of sources.keys()) {
    const chain = components.has(name) ? [name] : [];
    for (const edge of edges.get(name)!) visit(edge.target, chain);
  }

  const validators = new Map<string, ValidateFunction>();
  try {
    const ajv = new Ajv2020({
      strict: true,
      allErrors: false,
      ownProperties: true,
      coerceTypes: false,
      useDefaults: false,
      removeAdditional: false,
      inlineRefs: false,
      loopRequired: 32,
      loopEnum: 32,
      messages: false,
      verbose: false,
      code: { optimize: false },
    });
    ajv.addSchema({ $schema: DIALECT, $id: REGISTRY, $defs: definitions });
    // Force strict compilation of unused components too, not just case roots.
    for (const name of sources.keys()) {
      const validator = ajv.getSchema(`${REGISTRY}#/$defs/${name}`);
      if (!validator) throw new CheckError("config.schema");
      validators.set(name, validator);
    }
  } catch {
    // Ajv diagnostics can include schema and enum values; never expose them.
    throw new CheckError("config.schema");
  }
  return validators;
}
