# Contract: unreleased 0.1.0

This document defines the supported subset and observable report format. Inputs outside it are not promised acceptance even if valid under broader OpenAPI or JSON Schema specifications. There is no complete OpenAPI conformance check.

## Entry points

The compiled CommonJS library exports:

- `checkDocuments(openapi: unknown, suite: unknown): Report`: synchronous; checks ordinary in-memory JSON trees. Returns a report for payload mismatches. Throws `CheckError` for configuration/resource problems. Does not mutate either input.
- `checkFiles(openapiPath: string, suitePath: string): Promise<Report>`: reads the first explicit file, then the second, applying the same checks. Rejects with `CheckError` for known errors. Reads regular files only; follows explicit file symlinks but does not search directories or resolve references as paths.
- `parseJsonDocument(text: string): JsonValue`: bounded JSON parsing and inspection; throws `CheckError`.
- `CheckError`: `code: string`, optional `context: CaseContext`. Its message is only the code.
- `configurationReport(error: unknown): Report`: projects a known error, or maps an unknown error to `config.internal`.
- Immutable `LIMITS`, `DIALECT` and TypeScript types `JsonValue`, `JsonObject`, `CaseContext`, `Diagnostic`, `Report`.

No API retrieves URLs. Runtime dependencies are Ajv and its installed dependencies; there is no API-key, model or provider dependency.

## JSON representation

CLI files must be UTF-8 JSON without BOM. Invalid UTF-8, syntax errors and non-finite parsed numbers fail with `config.json`. JSON parsing uses JavaScript numbers, not arbitrary-precision decimals. Duplicate object keys use `JSON.parse` last-key behavior; duplicate-key detection is not implemented.

In-memory inputs must be trees of null, finite numbers, booleans, strings, dense ordinary arrays and ordinary/null-prototype objects with enumerable own data properties. Repeated object identities, cycles, accessors, symbols, non-enumerable object fields and custom prototypes are rejected. Do not pass Proxies or objects supplied by executable untrusted JavaScript. Source-file bytes include whitespace. In-memory byte accounting uses the compact JSON representation, including escaped strings.

## Suite

The root is exactly `{ "cases": [...] }` with 1–128 cases and no other fields. A request case has exactly `id`, `operationId`, `kind: "request"`, and `payload`. A response case also has `kind: "response"` and `status`. Every payload is present, including when its value is null.

`id` and `operationId` match `[A-Za-z][A-Za-z0-9_.-]{0,63}`. IDs are unique across the suite. Response status is a string matching `[1-5][0-9]{2}`, i.e. an exact HTTP status from 100 to 599. It is forbidden on requests. Extra fields are configuration errors. An empty suite is an error rather than a vacuous pass.

Cases are processed in ascending ID order using JavaScript code-unit comparison. The suite's original order is not significant for successful validation or mismatch reporting. Structural suite errors are detected before sorting; their precedence is not a compatibility promise.

## OpenAPI selection

- Root must be an object with `openapi` exactly `3.1.1` and an object `paths`.
- Paths must start with `/` and have inline Path Item objects. Path Item references are unsupported.
- The lowercase methods `get`, `put`, `post`, `delete`, `options`, `head`, `patch`, `trace` are indexed. Every discovered operation must be an inline object with an identifier-shaped `operationId`. Duplicates anywhere in this index are rejected, even if not selected. A case ID lookup must resolve exactly once.
- Requests select the inline `requestBody`. Responses select the inline object at exactly `responses[status]`. No `default`, `2XX` or other wildcard fallback is attempted. Such response entries may coexist but are not inspected unless an exact numeric entry is selected.
- The selected body must contain an object `content` with exactly one key, `application/json`. Alternative or additional media types, parameters on media types and vendor JSON types are unsupported. Its media object must contain `schema`, which may be boolean. Body, response and media Reference Objects are unsupported.
- Request-body `required` has no additional effect: the suite already supplies an explicit body value. Absence of a body cannot be represented as a case.
- Media examples, example references and `externalValue` are ignored and never fetched. Suite payloads are the only examples checked.

All component schemas and distinct selected schemas are inspected and compiled. Unselected bodies and fields outside the described index/selection are not checked. `info`, descriptions, parameters, response headers, callbacks, webhooks, security requirements and general OpenAPI structural correctness are outside scope. Thus accepting a document does not establish that it is valid OpenAPI.

## Dialect and schema vocabulary

The dialect URI is exactly `https://json-schema.org/draft/2020-12/schema`. An absent top-level `jsonSchemaDialect` is interpreted as this tool's 2020-12 subset assumption. Any explicit `jsonSchemaDialect` or schema `$schema` must equal that URI, without a trailing fragment. OpenAPI's base dialect URI and other dialects are configuration errors.

Supported schema objects may contain only:

| Keywords | Restriction |
| --- | --- |
| `$schema` | Exact supported dialect URI |
| `$ref` | Exact supported local component reference |
| `type` | One string: object, array, string, number, integer, boolean, null; no type arrays |
| `properties`, `required` | Object properties and required names; Ajv strict typing/strictRequired applies |
| `additionalProperties` | Boolean only |
| `items` | One boolean/object schema, not a tuple |
| `minItems`, `maxItems` | Ajv 2020-12 semantics |
| `minLength`, `maxLength` | Ajv 2020-12 semantics, Unicode code-point lengths |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` | Ajv numeric semantics on JavaScript numbers |
| `enum` | 1–64 primitive JSON members; Ajv checks uniqueness |
| `const` | Primitive JSON value only |
| `title`, `description`, `default`, `readOnly`, `writeOnly` | Annotations; meta-schema types are checked |

Boolean schemas are supported. Keyword value syntax is checked by Ajv's 2020-12 meta-schema and strict compiler, not a home-grown assertion engine. Property names have at most 64 UTF-16 code units and cannot be `__proto__`, `prototype`, or `constructor`. Other property names, including slash and tilde, are allowed.

`format` is always rejected as `config.format`, even for formats that an optional Ajv plugin could understand. `readOnly` and `writeOnly` do not affect acceptance by direction. Defaults are never applied. Coercion and additional-field removal are disabled. There is no annotation collection in the public report.

All other schema keywords are rejected, including `pattern`, `patternProperties`, `allOf`, `anyOf`, `oneOf`, `not`, conditionals, dependencies, `prefixItems`, `contains`, `uniqueItems`, `unevaluatedProperties`, `$defs`, `$id`, anchors and dynamic references. This list of examples is not an additional allowlist.

## References

Only literal `#/components/schemas/Name` is accepted, where `Name` matches `[A-Za-z][A-Za-z0-9_]{0,63}` and exists as an own component schema. No escaping, percent decoding, pointer suffixes, external files or remote URIs are supported. Component names themselves must satisfy the grammar, including unused ones.

References are rewritten into one private in-memory Ajv schema registry. No remote loader exists. `$ref` siblings retain JSON Schema 2020-12 semantics within the allowed vocabulary.

Each reference edge is classified as guarded if its schema position is below at least one `properties` member or `items` relative to its owner definition. The unguarded-edge subgraph must be acyclic. Consequently optional linked-object and recursive-array structures can be accepted, while direct alias cycles fail as `config.reference_cycle`.

## Inclusive limits and accounting

All limits allow the stated maximum and reject maximum plus one:

| Limit | Maximum |
| --- | ---: |
| UTF-8 bytes per file / compact in-memory document | 1,048,576 |
| JSON value nodes per document | 20,000 |
| JSON document depth, root = 0 | 64 |
| Cases | 128 |
| Payload depth, payload root = 0 | 32 |
| Schema nodes | 256 |
| Syntactic `$ref` occurrences | 64 |
| Distinct component names on a reference branch before a repeated name | 16 |
| Reference expansion visits | 4,096 |
| Members per enum | 64 |

JSON nodes count every container and primitive value, not object keys. A schema node is a boolean/object in schema position: each component root, each distinct selected schema root and recursively each `properties` member or `items`. Annotation contents and enum members do not count as schema nodes but do count toward document limits.

All component roots count, even unused ones. Selected roots are deduplicated only by operation ID, kind and exact response status; identical schema contents in different selections count separately. An entry root that is a reference counts both as a schema node and as a reference occurrence. No case payloads are compiled into schemas.

Reference expansion is a deterministic depth-first walk of outgoing references, in sorted schema-key/property order. Each component is a starting root with its own name on the chain; each selected entry starts with an empty chain. Every encountered target increments the shared visit counter, including a target already on the active chain. A repeated target ends that branch. Adding a seventeenth distinct component name fails. The visit limit also prevents exponentially branching graph exploration before Ajv compilation.

One validation diagnostic is retained per case. Document size, schema property-name limits, payload depth and the absence of additional-property subschemas bound instance-path length. No unbounded all-errors array is built. There is no hard wall-clock timeout in the library; see the security policy for hostile execution environments.

## Reports

A successful or mismatch result is:

```json
{
  "valid": false,
  "cases_checked": 1,
  "errors": [
    {
      "case_id": "example",
      "operationId": "submit",
      "kind": "response",
      "status": "200",
      "instance_path": "/items/0/count",
      "code": "type"
    }
  ]
}
```

`valid` is true iff `errors` is empty. `cases_checked` includes passing and failing cases. Errors contain only failing cases in sorted ID order. Requests omit `status`. `instance_path` is Ajv's JSON Pointer into the instance; the empty string means the root. Missing required-property names and additional-property names are not appended. Pointer escaping uses `~0` and `~1`.

`code` is the Ajv assertion keyword, such as `type`, `required`, `enum`, `const`, `additionalProperties`, `minimum`, `minItems` or `maxLength`. Ajv's boolean-false keyword is normalized to `false_schema`. The implementation pins Ajv to stabilize first-error behavior; consumers should not rely on a complete list or priority of all possible simultaneous failures.

The report never contains payload scalar values, enum values, schema documents, Ajv `params`, raw messages or filenames. Schema-declared property names in instance paths and caller-supplied case/operation identifiers are intentionally visible metadata and must not contain secrets.

## Configuration diagnostics and CLI

CLI syntax is exactly:

```sh
node build/src/cli.js OPENAPI_JSON CASE_SUITE_JSON
```

Exactly two nonempty arguments not starting with `-` are required. A filename starting with a dash can be explicitly prefixed with `./`. There is no stdin mode, file discovery or flag parser. `npm run cli -- examples/api.json examples/valid-cases.json` is equivalent after compilation, except for npm's own script output.

The executable writes one pretty-printed JSON report and newline to stdout, and no diagnostics to stderr. Output-stream failure sets exit code 2. Exit codes are 0 for all valid, 1 for payload mismatches, 2 for usage/I/O/configuration/limit failure. Configuration failure reports always have `valid: false`, `cases_checked: 0`, and one diagnostic with `instance_path: ""`. A known selection or payload-depth context may accompany it; global configuration failures omit case metadata. No partial validation report is returned.

Stable configuration codes:

- `usage.arguments`: wrong argument count or shape.
- `io.read`: regular-file open/read/type failure; deliberately generic.
- `config.json`: invalid JSON/UTF-8 or unsupported in-memory representation.
- `config.document`, `config.version`, `config.dialect`, `config.paths`, `config.components`: document configuration.
- `config.suite`, `config.case`, `config.case_duplicate`: suite configuration.
- `config.operation`, `config.operation_id`, `config.operation_ambiguous`, `config.operation_missing`: index or lookup problems.
- `config.body`, `config.responses`, `config.status`, `config.content`, `config.media_type`, `config.schema_missing`: body selection problems.
- `config.component_name`, `config.reference`, `config.reference_missing`, `config.reference_cycle`: local reference problems.
- `config.schema`, `config.schema_keyword`, `config.schema_property`, `config.format`: malformed/unsupported schema configuration. Ajv exceptions are collapsed to `config.schema` without sensitive details.
- `limit.document_bytes`, `limit.document_nodes`, `limit.document_depth`, `limit.cases`, `limit.payload_depth`, `limit.schema_nodes`, `limit.references`, `limit.reference_depth`, `limit.reference_visits`, `limit.enum_values`: named bounds.
- `config.internal`: unexpected error projected by the CLI, without internal details.

When multiple configuration defects exist, which one is reported first is not a compatibility guarantee. The same unchanged inputs and dependency versions nevertheless produce deterministic output.
