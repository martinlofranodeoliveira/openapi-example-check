# OpenAPI Example Check

An offline checker of explicit JSON request/response body examples against a **documented subset of OpenAPI 3.1.1 and JSON Schema 2020-12**. By [Lofrano Tecnologia](https://lofranotecnologia.com.br), maintained under the GitHub owner [martinlofranodeoliveira](https://github.com/martinlofranodeoliveira).

This is not a complete OpenAPI validator. It does not call an API, start an HTTP server, extract embedded examples, or assert that a service behaves as documented. All included fixtures are synthetic. There are no credentials, telemetry, model calls or runtime network dependencies.

## Install, test and demonstrate

Use Node.js 22 or later and npm. From the project directory:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run demo
npm run cli -- examples/api.json examples/valid-cases.json
```

Direct dependencies are pinned: Ajv 8.17.1 at runtime, TypeScript 7.0.2 and `@types/node` 22.20.5 for development only. The generated `package-lock.json` is included; use `npm ci --ignore-scripts --no-audit --no-fund` for subsequent locked installations. Tests compile first with strict checking, including dependency declarations, and run with `node --test`. Tests and the demo need no external network access after installation.

The CLI command above prints a report after npm's script headers:

```json
{
  "valid": true,
  "cases_checked": 3,
  "errors": []
}
```

For **only** machine-readable output, build once and invoke Node directly:

```sh
npm run build
node build/src/cli.js examples/api.json examples/invalid-cases.json
```

That command exits 1. Its first failure is:

```json
{
  "case_id": "a-missing",
  "operationId": "createOrder",
  "kind": "request",
  "instance_path": "",
  "code": "required"
}
```

The complete report contains four failures, sorted by case ID: `a-missing/required`, `b-type/type` at `/items/0/quantity`, `c-enum/enum` at `/state`, and `d-extra/additionalProperties` at the root. Response diagnostics also contain their exact `status`. Payload values, enum members, schema documents and Ajv messages are not included.

`npm run demo` prints human-readable headings, both complete JSON reports, then `Expected outcomes confirmed; no network requests were made.` It asserts the expected counts, IDs, keywords and paths, and exits 0 when the deliberately failing examples fail as expected.

## Two explicit input files

The OpenAPI file is JSON, with `openapi` exactly `3.1.1`, operations under `paths`, and JSON body schemas. For example:

```json
{
  "openapi": "3.1.1",
  "paths": {
    "/synthetic": {
      "post": {
        "operationId": "submit",
        "requestBody": {
          "content": { "application/json": { "schema": { "type": "integer" } } }
        },
        "responses": {
          "200": {
            "description": "Synthetic result",
            "content": { "application/json": { "schema": { "type": "string" } } }
          }
        }
      }
    }
  }
}
```

Its separate case-suite file is:

```json
{
  "cases": [
    { "id": "a-request", "operationId": "submit", "kind": "request", "payload": 7 },
    { "id": "b-response", "operationId": "submit", "kind": "response", "status": "200", "payload": "synthetic-result" }
  ]
}
```

Every ID is unique. `status` is required only for responses and forbidden for requests. It is a string, not a number. Cases are sorted by ID before selection and reporting. No wildcard or `default` response fallback is performed.

## Library

After `npm run build`, a local CommonJS consumer can use:

```js
const { checkFiles, CheckError } = require('./build/src/index.js');

checkFiles('examples/api.json', 'examples/valid-cases.json')
  .then(report => console.log(JSON.stringify(report)))
  .catch(error => {
    console.error(error instanceof CheckError ? error.code : 'unexpected');
    process.exitCode = 2;
  });
```

`checkDocuments(openapi, suite)` is the synchronous in-memory API. It returns the same report for payload mismatches and throws `CheckError` for configuration problems. `parseJsonDocument(text)` applies the JSON input limits. Public declarations are emitted during the build. See [the stable contract](docs/contract.md).

## Supported subset and policy

- Ajv's **2020-12 validator in strict mode** performs schema and payload validation; this project does not implement JSON Schema validation itself.
- Inline boolean/object schemas and local `#/components/schemas/Name` references are supported. Names match `[A-Za-z][A-Za-z0-9_]{0,63}`. References are rewritten into one private, in-memory registry. Guarded recursion through properties or array items is allowed; non-progress reference cycles are rejected.
- Supported assertion keywords cover single `type`, object `properties`/`required`/boolean `additionalProperties`, homogeneous `items`, array length, string length, numeric bounds/multiples, primitive `enum` and primitive `const`. The complete list is in the contract. No regular expressions, combinators, tuple schemas, schema-valued additional properties, custom keywords or format plugins are enabled.
- `readOnly`, `writeOnly`, `default`, `title` and `description` are annotations. They do not enforce request/response access control. No coercion, defaults or removal of additional fields occurs. Every `format`, including familiar formats, is rejected rather than silently ignored.
- The tool interprets an absent dialect declaration as 2020-12 **for this subset**, not as OpenAPI's general default dialect. Explicit `jsonSchemaDialect` and `$schema` must be exactly `https://json-schema.org/draft/2020-12/schema`.
- All discovered HTTP operations need unique identifier-shaped `operationId` values. All components and selected body schemas are checked. Unselected operation bodies, parameters, security requirements, headers, callbacks and embedded examples are not validated.
- A selected body must have exactly one media type: `application/json`. Request-body/response Reference Objects, external references, anchors, alternate JSON Pointer shapes, unsupported versions/dialects and unresolved IDs are configuration errors. Remote schemas and external examples are never fetched.

## Limits and exit codes

Per document: 1,048,576 UTF-8 bytes, 20,000 JSON value nodes and depth 64. A suite has 1–128 cases; payload depth is at most 32. Across all components plus distinct selected schemas: 256 schema nodes, 64 reference occurrences, reference-chain depth 16, 4,096 reference-expansion visits, and at most 64 primitive enum members per enum. Root depth is zero. Property names are limited to 64 UTF-16 code units and three prototype-sensitive names are rejected. Exact accounting is in the contract.

The CLI emits one JSON report on stdout, no raw I/O diagnostics, and exits:

| Code | Meaning |
| --- | --- |
| 0 | All supplied cases validate |
| 1 | At least one payload mismatch; all cases were checked |
| 2 | Usage, I/O, configuration or resource-limit failure; no partial result |

Only the first Ajv failure per case is reported, keeping output bounded. Ordinary JavaScript number semantics apply; duplicate JSON object keys use `JSON.parse` last-key behavior. There is no wall-clock deadline or claim of safe multi-tenant execution of hostile schemas; use process isolation and external deadlines for that setting. See [design](docs/design.md) and [security](SECURITY.md).

## Why this tool, rather than http-fixture-lab?

The distinction is schema checking versus HTTP interaction. OpenAPI Example Check consumes two files and verifies body values against selected schemas. It neither replays nor serves HTTP fixtures, matches live requests, nor checks transport behavior. A fixture-oriented tool such as `http-fixture-lab` belongs to a different layer; passing these checks says nothing about HTTP status delivery, headers, latency or a running service.

## Project status and license

Unreleased 0.1.0; no deployment, certification or production-readiness claims. MIT, copyright 2026 Lofrano Tecnologia. See [contributing](CONTRIBUTING.md), [changelog](CHANGELOG.md) and [Português](README.pt-BR.md).
