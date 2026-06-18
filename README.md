# servicetitan-mcp

A remote [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes the ServiceTitan API as MCP tools to clients like Claude. It runs as a single [Cloudflare Worker](https://developers.cloudflare.com/workers/), speaks MCP over **Streamable HTTP** at `POST /mcp`, and talks **directly** to the ServiceTitan API using your own ServiceTitan app credentials.

> **Unofficial — not affiliated with or endorsed by ServiceTitan, Inc.** This is an independent, community-maintained connector. "ServiceTitan" is a trademark of its respective owner. See [TRADEMARK.md](./TRADEMARK.md).

---

## Features

- **76 tools** spanning CRM, jobs & appointments, pricebook, invoicing, estimates, dispatch, dispatch-pro, marketing, memberships, calls & forms, tasks, payroll, inventory, opportunities, and reporting — plus 6 cross-domain composites and one admin-only raw API gateway.
- **Bring your own credentials.** No credentials are bundled. The Worker authenticates to ServiceTitan via OAuth 2.0 client-credentials using *your* ServiceTitan app, scoped to *your* tenant.
- **Write safety by default.** State-changing tools use a two-phase `dryRun → confirm` flow gated by an HMAC confirmation token. A single env var (`WRITE_GATE=off`) disables it; `MCP_LOCKDOWN=true` forces the server fully read-only.
- **MCP tool annotations** (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) are emitted for every tool so clients can reason about effects.
- **Built-in observability.** Every call is audited to a Cloudflare D1 database (audit log + error log), with optional Analytics Engine metrics and admin inspection routes.
- **Per-endpoint-family rate limiting** via a Durable Object, protecting your ServiceTitan API quota.
- **Inbound auth** with a shared `X-Sync-Key` header or an optional signed JWT.
- Runs at the edge on Cloudflare Workers with per-request MCP server isolation, built on the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) (`createMcpHandler`) and the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) (`McpServer`).

---

## Architecture

```
  ┌─────────────┐   Streamable HTTP    ┌────────────────────────────┐
  │ MCP client  │  POST /mcp           │   servicetitan-mcp          │
  │ (Claude,    │ ───────────────────► │   (Cloudflare Worker)       │
  │  agents,    │   X-Sync-Key / JWT   │                             │
  │  scripts)   │ ◄─────────────────── │  • createMcpHandler         │
  └─────────────┘                      │  • 76 tools + annotations   │
                                       │  • write-gate (dryRun/HMAC) │
                                       └──────────┬──────────────────┘
                                                  │
                 ┌────────────────────────────────┼────────────────────────────┐
                 ▼                                 ▼                            ▼
        ┌──────────────────┐          ┌──────────────────────┐     ┌────────────────────┐
        │ ServiceTitan API │          │ D1 (your account)    │     │ Durable Object     │
        │ OAuth 2.0        │          │ audit_log / error_log│     │ per-endpoint-family│
        │ client-creds     │          │ + read cache         │     │ rate limiter       │
        └──────────────────┘          └──────────────────────┘     └────────────────────┘
```

Each MCP request gets an isolated `McpServer` instance. Read tools hit the ServiceTitan API (with optional caching); write tools route through the write-gate; every invocation is recorded to your own D1 database and, optionally, Analytics Engine.

---

## Prerequisites

1. **A ServiceTitan app.** From the ServiceTitan developer portal, create an app and obtain:
   - a **Client ID** and **Client Secret** (OAuth 2.0 client-credentials),
   - an **App Key**,
   - your **Tenant ID**.

   Scope the app to only the API areas you intend to use (least privilege).
2. **A Cloudflare account** with Workers enabled, plus [`wrangler`](https://developers.cloudflare.com/workers/wrangler/) installed and authenticated.
3. **Node.js 18+** and `npm`.

You provision your own Cloudflare D1 database and Durable Object bindings — see `wrangler.toml` for the binding names and replace the placeholder resource IDs with your own.

---

## Quick start

```bash
# 1. Clone and install
git clone <your-fork-url> servicetitan-mcp
cd servicetitan-mcp
npm install

# 2. Set your ServiceTitan + inbound-auth secrets (never commit these)
wrangler secret put ST_CLIENT_ID
wrangler secret put ST_CLIENT_SECRET
wrangler secret put ST_APP_KEY
wrangler secret put MCP_SYNC_KEY

# 3. Edit wrangler.toml:
#    - set ST_TENANT_ID under [vars]
#    - replace the placeholder D1 database_id / DO bindings with your own

# 4. Run the test suite and type-check
npm test
npm run typecheck

# 5. Deploy
wrangler deploy
```

After deploy, confirm the Worker is live:

```bash
curl https://<your-worker>.workers.dev/health
```

Optional secrets — set only if you use the corresponding feature:

```bash
wrangler secret put JWT_SECRET          # enable signed-JWT inbound auth
wrangler secret put ST_WEBHOOK_SECRET   # enable HMAC-verified ServiceTitan webhook ingest
```

---

## Registering with an MCP client

Point any Streamable-HTTP MCP client at `https://<your-worker>/mcp` and send your sync key in the `X-Sync-Key` header.

For Claude (in `~/.claude.json`):

```json
{
  "mcpServers": {
    "servicetitan": {
      "type": "http",
      "url": "https://<your-worker>.workers.dev/mcp",
      "headers": {
        "X-Sync-Key": "<your MCP_SYNC_KEY value>"
      }
    }
  }
}
```

If you enabled `JWT_SECRET`, you may instead send `Authorization: Bearer <signed-JWT>`.

---

## Tool catalog

76 tools grouped by ServiceTitan domain. Tools marked **write** mutate state and pass through the write-gate (`dryRun → confirm`); everything else is read-only. `st_call` is **admin-only**.

### CRM & customers

| Tool | Purpose | Type |
| --- | --- | --- |
| `find_customer` | Search customers by name, phone, or email | read |
| `get_customer` | Get a customer by ID | read |
| `st_get_customer` | Get a customer by ID (thin wrapper) | read |
| `st_list_customers` | List / search customers | read |
| `get_customer_locations` | List a customer's service locations | read |
| `list_customer_jobs` | List a customer's jobs | read |
| `get_customer_membership` | Get a customer's memberships | read |
| `add_customer_note` | Append a note to a customer record | write |

### Jobs & appointments

| Tool | Purpose | Type |
| --- | --- | --- |
| `get_job` | Get a job by ID | read |
| `st_list_jobs` | List / search jobs | read |
| `list_jobs_today` | List jobs scheduled for today | read |
| `get_job_appointments` | List appointments for a job | read |
| `st_list_appointments` | List / search appointments | read |
| `jobs_hold_reasons_list` | List configured job hold reasons | read |
| `book_job` | Book a new job | write |
| `reschedule_appointment` | Reschedule an appointment | write |
| `hold_appointment` | Place an appointment on hold | write |
| `assign_technicians` | Assign technicians to an appointment | write |
| `add_job_note` | Append a note to a job | write |

### Pricebook

| Tool | Purpose | Type |
| --- | --- | --- |
| `search_pricebook_all` | Search across services, materials, and equipment | read |
| `search_pricebook_services` | Search pricebook services | read |
| `search_materials` | Search pricebook materials | read |
| `get_service_details` | Get full details for a service | read |
| `get_configurable_equipment_children` | List child variations of configurable equipment | read |
| `list_service_categories` | List pricebook service categories | read |
| `st_get_pricebook` | Generic pricebook fetch | read |
| `st_create_service` | Create a pricebook service | write |
| `st_patch_service` | Update a pricebook service | write |
| `st_create_material` | Create a pricebook material | write |
| `st_patch_material` | Update a pricebook material | write |

### Invoicing

| Tool | Purpose | Type |
| --- | --- | --- |
| `get_invoice` | Get an invoice with line items and totals | read |
| `list_invoices_job` | List invoices for a job | read |
| `get_invoice_balance` | Get an invoice's outstanding balance | read |
| `list_unpaid_invoices` | List invoices with an outstanding balance | read |

### Estimates

| Tool | Purpose | Type |
| --- | --- | --- |
| `get_estimate` | Get an estimate with line items and status | read |
| `list_estimates_job` | List estimates for a job | read |
| `sell_estimate` | Mark an estimate sold | write |
| `unsell_estimate` | Revert a sold estimate to open | write |
| `dismiss_estimate` | Dismiss an estimate | write |

### Dispatch

| Tool | Purpose | Type |
| --- | --- | --- |
| `get_capacity` | Get dispatch capacity for business units over a range | read |
| `st_get_capacity_slots` | Discover bookable capacity slots | read |
| `list_technicians_available` | List technicians available on a date | read |
| `get_technician_shifts` | Get a technician's scheduled shifts | read |
| `list_non_job_events` | List non-job dispatch events (time-off, training) | read |

### Dispatch Pro

| Tool | Purpose | Type |
| --- | --- | --- |
| `dispatch_pro_utilization_list` | List technician utilization metrics | read |
| `dispatch_pro_ratio_list` | List dispatch ratio metrics | read |
| `dispatch_pro_alerts_list` | List dispatch alerts | read |

### Marketing

| Tool | Purpose | Type |
| --- | --- | --- |
| `list_campaigns` | List marketing campaigns | read |
| `get_campaign_performance` | Get campaign performance metrics | read |
| `create_call_with_campaign` | Create a call record attributed to a campaign | write |

### Memberships

| Tool | Purpose | Type |
| --- | --- | --- |
| `list_memberships_active` | List active memberships | read |
| `list_memberships_expiring` | List memberships expiring within N days | read |
| `create_recurring_service` | Create a recurring service under a membership | write |

### Calls & forms

| Tool | Purpose | Type |
| --- | --- | --- |
| `get_call` | Get a telecom call record | read |
| `get_form_submission` | Get a form submission record | read |

### Tasks

| Tool | Purpose | Type |
| --- | --- | --- |
| `list_open_tasks` | List open (incomplete) tasks | read |
| `create_task` | Create a task | write |

### Payroll

| Tool | Purpose | Type |
| --- | --- | --- |
| `payroll_payrolls_list` | List payrolls | read |
| `payroll_job_timesheets_list` | List job timesheets | read |
| `payroll_non_job_timesheets_list` | List non-job timesheets | read |
| `payroll_location_rates_list` | List location pay rates | read |
| `payroll_settings_get` | Get payroll settings | read |

### Inventory

| Tool | Purpose | Type |
| --- | --- | --- |
| `inventory_vendors_list` | List inventory vendors | read |
| `inventory_warehouses_list` | List warehouses | read |
| `inventory_receipts_list` | List inventory receipts | read |
| `inventory_transfers_list` | List inventory transfers | read |

### Opportunities

| Tool | Purpose | Type |
| --- | --- | --- |
| `opportunities_list` | List opportunities | read |
| `opportunity_get` | Get an opportunity by ID | read |

### Reporting

| Tool | Purpose | Type |
| --- | --- | --- |
| `st_run_report` | Run a ServiceTitan report and return rows | read |

### Composites (cross-domain)

| Tool | Purpose | Type |
| --- | --- | --- |
| `customer_snapshot` | Full customer view: details, locations, jobs, memberships, estimates, invoices in one call | read |
| `margin_audit` | Margin analysis across jobs | read |
| `job_cost_actuals` | Actual job costs (labor + materials) | read |
| `membership_value_leaderboard` | Rank customers / memberships by value | read |
| `dispatch_override_audit` | Audit manual dispatch overrides | read |
| `open_opportunities_feed` | Feed of open opportunities | read |

### Admin

| Tool | Purpose | Type |
| --- | --- | --- |
| `st_call` | Raw ServiceTitan API gateway (admin-only). GET reads; non-GET passes through the write-gate. | write (admin) |

---

## Write safety

State-changing tools never mutate ServiceTitan in a single shot. They follow a two-phase flow:

1. **`dryRun` (default).** The tool validates inputs, builds the exact request it *would* send, and returns a preview plus a short-lived **HMAC confirmation token**. Nothing is written.
2. **Confirm.** Call the tool again with `dryRun: false` and the returned token. The server verifies the token (HMAC over the request shape, time-bounded) and only then issues the write.

This makes accidental or hallucinated writes impossible without an explicit, verifiable second step.

- The write-gate is **on by default**. Set `WRITE_GATE=off` (var) to disable the two-phase flow.
- Set `MCP_LOCKDOWN=true` (var) to force the server **fully read-only** — every write tool and the admin gateway are stripped from the catalog regardless of `WRITE_GATE`.

Every tool also advertises MCP annotations so clients can pre-filter destructive operations:

| Annotation | Meaning |
| --- | --- |
| `readOnlyHint` | Tool performs no writes |
| `destructiveHint` | Tool may make irreversible changes |
| `idempotentHint` | Repeated identical calls have no extra effect |
| `openWorldHint` | Tool reaches an external system (always true here — the ServiceTitan API) |

---

## Auth & roles

**Inbound** (client → Worker): every `POST /mcp` request must present either

- an `X-Sync-Key` header matching the `MCP_SYNC_KEY` secret, or
- an `Authorization: Bearer <JWT>` signed with the optional `JWT_SECRET`.

Requests without valid credentials are rejected before any tool runs.

**Roles** determine which slice of the catalog a caller sees:

| Role | Catalog |
| --- | --- |
| `default` | All tools except admin-only (`st_call`) |
| `admin` | Full catalog including `st_call` |
| `lockdown` | Read-only tools only (forced when `MCP_LOCKDOWN=true`) |

**Outbound** (Worker → ServiceTitan): OAuth 2.0 client-credentials using your `ST_CLIENT_ID` / `ST_CLIENT_SECRET` / `ST_APP_KEY` against your `ST_TENANT_ID`. Tokens are obtained and refreshed by the Worker; no ServiceTitan credentials ever leave your infrastructure.

---

## Observability & admin endpoints

All admin routes require the `X-Sync-Key` header.

| Route | Purpose |
| --- | --- |
| `GET /health` | Liveness probe + tool inventory |
| `GET /admin/roles` | Effective role / catalog resolution |
| `GET /admin/metrics` | Tool-call summary from the audit log |
| `GET /admin/health/audit` | Last-activity probe (detect telemetry silence) |
| `GET /admin/endpoints` | Inventory of ServiceTitan endpoints each tool maps to |
| `GET /admin/endpoints/coverage` | Pass/fail gate on endpoint-descriptor coverage |
| `POST /webhooks/st` | Optional HMAC-verified ServiceTitan webhook ingest (requires `ST_WEBHOOK_SECRET`) |

Every tool call is written to your D1 `audit_log` (and `error_log` on failure). If you bind an Analytics Engine dataset, per-call metrics are emitted there as well.

---

## Configuration

### Secrets (`wrangler secret put`)

| Secret | Required | Purpose |
| --- | --- | --- |
| `ST_CLIENT_ID` | yes | ServiceTitan OAuth client ID |
| `ST_CLIENT_SECRET` | yes | ServiceTitan OAuth client secret |
| `ST_APP_KEY` | yes | ServiceTitan app key |
| `MCP_SYNC_KEY` | yes | Inbound shared key clients send as `X-Sync-Key` |
| `JWT_SECRET` | no | Enables signed-JWT inbound auth |
| `ST_WEBHOOK_SECRET` | no | HMAC secret for `POST /webhooks/st` |

### Vars (`wrangler.toml`)

| Var | Default | Purpose |
| --- | --- | --- |
| `ST_TENANT_ID` | — | Your ServiceTitan tenant ID |
| `ST_ENV` | `production` | ServiceTitan environment: `production` or `integration` |
| `MCP_SERVICE_VERSION` | — | Version string reported by `/health` |
| `WRITE_GATE` | `on` | Set to `off` to disable the two-phase write flow |
| `MCP_LOCKDOWN` | `false` | Set to `true` to force read-only mode |

---

## Security

See [SECURITY.md](./SECURITY.md) for the threat model, hardening guidance, supported versions, and how to report a vulnerability.

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, tests, and how to add a tool.

## License

[MIT](./LICENSE).

## Trademark

See [TRADEMARK.md](./TRADEMARK.md). This project is an independent, unofficial connector and is not affiliated with or endorsed by ServiceTitan, Inc.
