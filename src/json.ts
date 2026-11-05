import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { CheckError, LIMITS, type JsonValue } from "./model";

// Iterative inspection also protects the library entry point from cycles,
// accessors, non-JSON values and excessive in-memory trees.
export function inspectDocument(input: unknown): asserts input is JsonValue {
  const stack: { value: unknown; depth: number }[] = [{ value: input, depth: 0 }];
  const seen = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;
  function add(count: number): void {
    bytes += count;
    if (bytes > LIMITS.documentBytes) throw new CheckError("limit.document_bytes");
  }
  function stringBytes(value: string): number {
    if (value.length > LIMITS.documentBytes) throw new CheckError("limit.document_bytes");
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  }
  while (stack.length !== 0) {
    const item = stack.pop()!;
    if (++nodes > LIMITS.documentNodes) throw new CheckError("limit.document_nodes");
    if (item.depth > LIMITS.documentDepth) throw new CheckError("limit.document_depth");
    const value = item.value;
    if (value === null) { add(4); continue; }
    if (typeof value === "string") { add(stringBytes(value)); continue; }
    if (typeof value === "boolean") { add(value ? 4 : 5); continue; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new CheckError("config.json");
      add(String(value).length);
      continue;
    }
    if (typeof value !== "object") throw new CheckError("config.json");
    if (seen.has(value)) throw new CheckError("config.json");
    seen.add(value);
    const array = Array.isArray(value);
    const prototype: unknown = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
      throw new CheckError("config.json");
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new CheckError("config.json");
    if (array && value.length > LIMITS.documentNodes) throw new CheckError("limit.document_nodes");
    const keys = Object.keys(value);
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== keys.length + (array ? 1 : 0)) throw new CheckError("config.json");
    if (keys.length > LIMITS.documentNodes) throw new CheckError("limit.document_nodes");
    if (array && keys.length !== value.length) throw new CheckError("config.json");
    add(2 + Math.max(0, keys.length - 1));
    for (let i = 0; i < keys.length; i++) {
      const key = array ? String(i) : keys[i]!;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new CheckError("config.json");
      }
      if (!array) add(stringBytes(key) + 1);
      stack.push({ value: descriptor.value as unknown, depth: item.depth + 1 });
    }
  }
}

export function parseJsonDocument(text: string): JsonValue {
  if (Buffer.byteLength(text, "utf8") > LIMITS.documentBytes) {
    throw new CheckError("limit.document_bytes");
  }
  let value: unknown;
  try { value = JSON.parse(text) as unknown; }
  catch { throw new CheckError("config.json"); }
  inspectDocument(value);
  return value;
}

export async function readJsonDocument(path: string): Promise<JsonValue> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    // NONBLOCK prevents an explicitly supplied FIFO from blocking on open.
    // Only regular files are subsequently accepted.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) throw new CheckError("io.read");
    if (stat.size > LIMITS.documentBytes) throw new CheckError("limit.document_bytes");
    const buffer = Buffer.alloc(LIMITS.documentBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await handle.read(buffer, offset, buffer.length - offset, null);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > LIMITS.documentBytes) throw new CheckError("limit.document_bytes");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, offset));
    } catch { throw new CheckError("config.json"); }
    return parseJsonDocument(text);
  } catch (error) {
    if (error instanceof CheckError) throw error;
    throw new CheckError("io.read");
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}

export function inspectPayloadDepth(payload: JsonValue): void {
  const stack: { value: JsonValue; depth: number }[] = [{ value: payload, depth: 0 }];
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (depth > LIMITS.payloadDepth) throw new CheckError("limit.payload_depth");
    if (value !== null && typeof value === "object") {
      for (const child of Object.values(value)) stack.push({ value: child, depth: depth + 1 });
    }
  }
}
