# Contributing

Contributions should preserve the small offline surface and explicit subset. Use original code only; do not submit private client code, real personal data, credentials, copied proprietary fixtures or unverifiable performance/deployment claims.

## Local checks

Use Node.js 22 or later:

```sh
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run demo
npm run cli -- examples/api.json examples/valid-cases.json
```

Installation generates the dependency lock; keep that generated file when preparing a contribution. Do not hand-author resolved dependency metadata. Subsequent locked installations can use `npm ci --ignore-scripts --no-audit --no-fund`. Build output belongs in ignored `build/`, not in source submissions.

## Changes and tests

- Use strict TypeScript and prefer the standard library for I/O and process work.
- Let Ajv implement supported JSON Schema assertions. Do not add parallel home-grown validation rules for payloads.
- Add independent expected outcomes, not tests computed by the same implementation being tested.
- Test negative cases, inclusive boundaries, generic diagnostics, report ordering and non-mutation.
- Keep tests offline after dependency installation. Do not add HTTP calls even for reference tests.
- For a new keyword, analyze compilation cost, validation cost, recursion and information disclosure before widening the allowlist.
- Document every contract change in both READMEs, the contract and the unreleased changelog. A change to status selection, limits or report fields needs explicit compatibility discussion.
- Keep CI read-only, time-bounded and limited to installation/build/test/demo. Do not add publishing or remote-deployment automation.

Security-sensitive issues should follow SECURITY.md rather than include exploit data or secrets in a public report. Ordinary issue reports should use minimal synthetic JSON and the tool version, Node version, expected code and observed code. Never attach real API payloads merely to reproduce a failure.
