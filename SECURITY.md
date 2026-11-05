# Security policy

## Scope

This unreleased 0.1.0 code accepts local JSON documents and compiles a restricted schema vocabulary using Ajv. It makes no production-readiness, certification or sandboxing claim. There is no telemetry, remote reference loader, credential handling, HTTP request or automatic update mechanism.

## Reporting

For a suspected vulnerability, use GitHub's private vulnerability reporting for `martinlofranodeoliveira/openapi-example-check` if available. Otherwise use the contact channel listed on https://lofranotecnologia.com.br to request a private discussion before sending details. No response-time guarantee is made. Do not include secrets, real personal data or private client documents; a minimal synthetic reproducer is preferred.

## Threat model and limits

Files are explicit caller choices. The tool reads only those two paths and never interprets schema references as filesystem paths. Symlinks for explicit file inputs may be followed. Do not grant the process filesystem access beyond what the caller is allowed to read. The reader rejects non-regular files and caps bytes even if the file grows after stat. Local filesystem operations themselves have no universal wall-clock deadline, particularly on remote mounts.

JSON parsing and inspection cap document size, node count and nesting. Schema inspection caps nodes, primitive enums, references and reference-graph exploration. Non-progress reference cycles are rejected. Regex and combinator keywords are excluded, reference inlining is disabled, and only one validation error per case is retained.

These are bounded-work precautions, not a proof of harmless execution for every adversarial schema or dependency bug. Ajv compilation and validation are synchronous. For untrusted multi-tenant workloads use process isolation, memory/CPU quotas and an external deadline. Do not expose the library directly as an unconstrained public schema-compilation service. The in-memory API accepts ordinary JSON trees, not adversarial executable objects or Proxies.

Reports omit raw Ajv messages/parameters, scalar payload values, enum values, schemas and filenames. Case IDs, operation IDs, response statuses and schema-declared instance-path property names remain visible by design. Do not embed secrets in identifiers or property names. This is not a general data-loss-prevention or anonymization tool.

JavaScript numeric precision and duplicate-key parsing behavior are documented limitations. Schema success does not enforce authorization, read/write access control, HTTP behavior or general OpenAPI validity. `format` is rejected explicitly instead of producing a false impression of format checking.

## Dependencies and workflows

Runtime code uses pinned Ajv; TypeScript and Node declarations are development-only. Review the generated lock and dependency changes. CI has read-only repository permissions, pinned action revisions and timeouts. There are no publishing or deployment workflows. Dependency installation may use the npm registry; checking files, tests and the demo do not require network access after installation.
