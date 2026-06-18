# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-06-18

Initial public release.

### Added

- Remote MCP server running as a single Cloudflare Worker, speaking MCP over **Streamable HTTP** at `POST /mcp` (Cloudflare Agents SDK `createMcpHandler` + `@modelcontextprotocol/sdk` `McpServer`, with per-request server isolation).
- **Direct ServiceTitan API integration** via OAuth 2.0 client-credentials — bring-your-own-credentials, no credentials bundled.
- **76 tools** across CRM, jobs & appointments, pricebook, invoicing, estimates, dispatch, dispatch-pro, marketing, memberships, calls & forms, tasks, payroll, inventory, opportunities, and reporting; 6 cross-domain composites; and one admin-only raw API gateway (`st_call`).
- **Write-gate**: two-phase `dryRun → confirm` flow with HMAC confirmation tokens for all state-changing tools, on by default (`WRITE_GATE=off` to disable).
- **MCP tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) emitted for every tool.
- **Inbound auth** via `X-Sync-Key` header or optional signed JWT (`JWT_SECRET`); `MCP_LOCKDOWN=true` forces read-only mode.
- **Role-based catalog** (`default`, `admin`, `lockdown`).
- **Observability**: per-call audit and error logging to Cloudflare D1, optional Analytics Engine metrics, and admin routes (`/health`, `/admin/roles|metrics|health/audit|endpoints|endpoints/coverage`).
- **Rate limiting** per ServiceTitan endpoint family via a Durable Object.
- Optional HMAC-verified ServiceTitan webhook ingest at `POST /webhooks/st` (`ST_WEBHOOK_SECRET`).

[1.0.0]: https://example.com/servicetitan-mcp/releases/tag/v1.0.0
