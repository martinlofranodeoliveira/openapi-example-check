# Design

## Purpose and boundaries

API documentation can contain perfectly parseable examples that contradict its own schemas. This tool checks explicit body values without contacting the described service. It deliberately does not combine schema checking with HTTP replay, mocking or service testing. It also does not claim full OpenAPI or JSON Schema vocabulary support.

Implementation code and tests are original to this project. Ajv is the external JSON Schema engine, used through its public API, not copied into the repository. No private client code or real personal data is included.

## Pipeline

1. Read only the two explicitly named regular files. A fixed-size buffer and an extra-byte check handle files that grow after stat. Nonblocking open plus a regular-file check avoids reading FIFOs or devices. Errors never contain the supplied filename or an OS error message.
2. Decode UTF-8 strictly and parse JSON. Iterative inspection limits bytes, nodes and nesting. The in-memory API also rejects cycles, aliases, accessors, sparse arrays, symbol properties and non-JSON objects. This API expects ordinary caller-owned data, not hostile JavaScript Proxy objects.
3. Require version 3.1.1 and the supported dialect policy. Check the suite structure, unique IDs and payload depths. Index standard HTTP methods under paths, rejecting ambiguous or malformed operation IDs before matching cases.
4. Sort cases by ID. Select the exact request or response JSON schema; memoize repeated selections. Selection is by operation ID, direction and exact response status, never by a URL request or status fallback.
5. Inspect all component schemas and distinct selected schemas. An allowlist restricts the supported vocabulary; it does not implement the assertions. Rewrite only verified component references to a private Ajv registry. Never rewrite strings inside annotation/default values as if they were schemas.
6. Check the reference graph. Reject unguarded cycles, excessive chains and excessive expansion work. Then ask Ajv to meta-validate and strictly compile every definition, including unused components. Ajv receives no asynchronous schema loader.
7. Validate cases without mutation. Emit only the first failure per case, projecting a small stable subset of Ajv's diagnostic. Neither `params` nor Ajv messages, schemas or data are copied into reports.

## Why a narrow vocabulary?

Regular expressions can have unpredictable runtime. Combinators and uncontrolled reference inlining can multiply work or generated code. This version excludes regex-based keywords, combinators, custom vocabularies, dynamic references and schema-valued additional properties. Enums and constants are primitive-only. Ajv reference inlining and code optimization are disabled; large required/enum checks use loops.

These restrictions trade expressiveness for a small, auditable offline tool. They also keep reported instance paths limited to schema-declared property names and array indexes. Unknown additional-property names are not printed, because Ajv's error parameters are discarded and additional-properties subschemas are unsupported.

Resource caps bound input, schema graph exploration and diagnostic count. They are not a hard CPU deadline. Ajv compilation is synchronous and cannot be preempted by this API. A hostile multi-tenant service should run the checker in a separately constrained process with an external deadline. The tool must not be advertised as a general sandbox.

## Reference safety

Component names have a deliberately unescaped ASCII grammar. A reference must be an exact literal `#/components/schemas/Name`; there is no percent decoding, pointer suffix traversal, file resolution or URL resolution. Internal rewritten URNs identify an already-installed in-memory schema only. `$id`, `$anchor`, `$dynamicRef`, `$defs` and all other reference shapes in input schemas are rejected.

Recursion is useful for structures such as optional linked nodes. A cycle is accepted only when at least one edge consumes a property or array item. A direct alias cycle would invoke validation again on the same value indefinitely, so the graph's unguarded-edge subgraph must be acyclic. Payload nesting limits bound the useful recursive data depth.

## Direction and annotation policy

Request versus response only chooses a schema. It does not remove read-only fields, require write-only omissions, enforce authentication, or reinterpret required properties. `readOnly`, `writeOnly` and `default` retain annotation status. Every `format` is an explicit configuration error; there is no quiet acceptance of an unchecked format.

Absent dialect declarations use the tool's 2020-12 subset assumption. This differs from interpreting an arbitrary OpenAPI document according to OpenAPI's default dialect. Explicit OpenAPI base-dialect declarations are rejected, preventing accidental claims of that dialect's support.

## Determinism and privacy

Case sorting uses JavaScript code-unit comparison rather than locale collation. Schema traversal sorts keys; components are sorted; cached selections are created in sorted case order. With the pinned Ajv version, identical inputs yield identical reports. Only one diagnostic is retained per invalid case, so consumers should treat the first keyword as diagnostic rather than as a complete failure inventory.

Identifiers and schema-declared instance-path property names are public report metadata. Do not place secrets in them. Payload scalar values, unknown property names, enum members and filenames are not included. Configuration failures invalidate the entire run, with `cases_checked: 0`; no partial success is returned.

## Verification strategy

Tests exercise the public API with independently spelled-out valid and invalid fixtures. They distinguish request and response schemas, exact status selection, missing fields, type/enum/array/object failures, pointer escaping and non-mutation. Adversarial tests cover strict schema failures, remote and malformed references, guarded and unguarded recursion, ambiguity, dialects, input trees and inclusive resource boundaries. Subprocess tests exercise actual stdout, exit codes and generic I/O errors. No test makes a network request.

The demonstration is a small regression oracle, not a benchmark or a deployment proof. It prints both accepted and intentionally rejected synthetic orders and checks the expected outcomes.

## Reference material

These are design references, not runtime downloads or claims of full conformance:

- https://spec.openapis.org/oas/v3.1.1.html
- https://json-schema.org/draft/2020-12/json-schema-core
- https://ajv.js.org/json-schema.html
- https://github.com/nodejs/docker-node
