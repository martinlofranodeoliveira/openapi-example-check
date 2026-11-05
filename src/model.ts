export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue }

export const DIALECT = "https://json-schema.org/draft/2020-12/schema";
export const LIMITS = Object.freeze({
  documentBytes: 1_048_576,
  documentNodes: 20_000,
  documentDepth: 64,
  cases: 128,
  payloadDepth: 32,
  schemaNodes: 256,
  references: 64,
  referenceDepth: 16,
  referenceVisits: 4096,
  enumValues: 64,
});

export interface CaseContext {
  case_id: string;
  operationId: string;
  kind: "request" | "response";
  status?: string;
}
export interface Diagnostic {
  code: string;
  instance_path: string;
  case_id?: string;
  operationId?: string;
  kind?: "request" | "response";
  status?: string;
}
export interface Report {
  valid: boolean;
  cases_checked: number;
  errors: Diagnostic[];
}

export class CheckError extends Error {
  constructor(public readonly code: string, public readonly context?: CaseContext) {
    super(code);
    this.name = "CheckError";
  }
}

export function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function own(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
export function configurationReport(error: unknown): Report {
  const known = error instanceof CheckError ? error : new CheckError("config.internal");
  return {
    valid: false,
    cases_checked: 0,
    errors: [{ ...known.context, instance_path: "", code: known.code }],
  };
}
