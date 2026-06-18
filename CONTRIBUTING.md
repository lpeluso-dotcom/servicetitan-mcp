# Contributing

Thanks for your interest in improving `servicetitan-mcp`. Contributions of all kinds are welcome — bug reports, docs, new tools, and hardening.

> This is an independent, unofficial connector and is not affiliated with ServiceTitan, Inc. See [TRADEMARK.md](./TRADEMARK.md).

## Getting set up

```bash
git clone <your-fork-url> servicetitan-mcp
cd servicetitan-mcp
npm install

npm test           # run the Vitest suite
npm run typecheck  # tsc --noEmit
```

You do **not** need a live ServiceTitan tenant to develop or run the tests — the suite mocks the upstream API. For local end-to-end runs, copy `.env.example` to `.env` and fill in local placeholders, then `npm run dev`.

Before opening a PR, make sure both pass:

```bash
npm run check      # typecheck + test
```

## Code style

- TypeScript, strict mode. Keep `npm run typecheck` clean.
- Validate all tool inputs with [`zod`](https://zod.dev) schemas.
- Prefer small, single-responsibility tool modules, one file per tool (see `src/tools/<domain>/`).
- No secrets, tenant identifiers, or customer data in code, tests, or fixtures.
- Match the existing formatting and import ordering in nearby files.

## Adding a tool

Tools live under `src/tools/<domain>/` and are registered in `src/tools/index.ts`. Each tool is a `ToolDef`:

```ts
export const my_tool: ToolDef<MyArgs> = {
  name: 'my_tool',
  description: 'One clear sentence describing what this returns or does.',
  zodSchema: { /* zod raw shape: field -> ZodType */ },
  isWrite: false,        // true for state-changing tools (routes through the write-gate)
  // adminOnly: true,    // only for privileged tools
  // annotations: { ... } // override the defaults derived from isWrite if needed
  stEndpoint: {          // declare the ServiceTitan endpoint this maps to
    method: 'GET',
    path: '/crm/v2/tenant/{tenant}/customers/{id}',
    source: 'live',
  },
  handler: async (env, args, ctx) => { /* ... */ },
};
```

Checklist for a new tool:

1. **Declare `stEndpoint`.** The `/admin/endpoints/coverage` gate fails if a non-exempt tool has no endpoint descriptor, and the coverage test runs in CI.
2. **Set `isWrite: true`** for anything that mutates state, so it inherits the two-phase `dryRun → confirm` write-gate and the correct MCP annotations.
3. **Register it** in the `TOOLS` array in `src/tools/index.ts`.
4. **Add tests** under `src/tools/__tests__/` (or the tool's domain test file). Cover both success and validation-failure paths; for writes, cover the dryRun → confirm flow.
5. **Update the tool catalog** table in `README.md`.

## Pull requests

- Branch from `main`; keep PRs focused and small.
- Reference any related issue.
- Describe behavior changes and note anything that affects auth, the write-gate, or the tool catalog.
- **All PRs run CI** (typecheck + tests + coverage gate). PRs must be green before merge.

## Issues

- For bugs, include the tool name, the request you made, expected vs. actual behavior, and the Worker/version.
- For feature requests, describe the ServiceTitan capability and the endpoint(s) involved.
- **Do not** file security problems as public issues — see [SECURITY.md](./SECURITY.md).

By contributing, you agree your contributions are licensed under the project's [MIT License](./LICENSE).
