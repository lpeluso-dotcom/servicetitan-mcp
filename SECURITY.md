# Security Policy

`servicetitan-mcp` is a remote MCP server that brokers privileged access to a ServiceTitan tenant. This document describes its threat model, the controls it ships with, how to operate it safely, and how to report a vulnerability.

> This is an independent, unofficial, community-maintained project and is not affiliated with or endorsed by ServiceTitan, Inc.

---

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

- Preferred: open a private [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) on this repository ("Report a vulnerability").
- Alternatively, email `<your-security-contact>`.

Please include a description, reproduction steps, affected version, and impact. We aim to acknowledge within a few business days and will coordinate a fix and disclosure timeline with you. We credit reporters unless you prefer to remain anonymous.

---

## Supported versions

Security fixes are provided for the latest minor release line. Older lines are best-effort.

| Version | Supported |
| --- | --- |
| 1.x | ✅ |
| < 1.0 | ❌ |

---

## Trust boundaries

```
  untrusted ──► [ MCP client ] ──HTTPS──► [ Worker: inbound auth ] ──► [ tool layer ]
                                                                          │
                                          OAuth client-creds ────────────►├──► ServiceTitan API
                                          (your tenant)                    │
                                                                          ├──► D1 (audit / cache)
                                                                          └──► Durable Object (rate limit)
```

The two boundaries that matter most:

1. **Client → Worker.** Anyone who can reach `POST /mcp` and present a valid credential can drive the tool catalog. The inbound credential (`MCP_SYNC_KEY` / JWT) is therefore as sensitive as the ServiceTitan credentials themselves.
2. **Worker → ServiceTitan.** The Worker holds long-lived OAuth client-credentials for your tenant. A compromise of the Worker's secrets is a compromise of your ServiceTitan tenant at the granted scope.

---

## Controls

### Bring-your-own-credentials

No credentials ship with this project. You supply your own ServiceTitan app (client id, client secret, app key) and tenant id. Operators are responsible for the lifecycle and scope of those credentials.

### Secrets management

- All sensitive values are Cloudflare **Worker secrets**, set via `wrangler secret put` and never written to source: `ST_CLIENT_ID`, `ST_CLIENT_SECRET`, `ST_APP_KEY`, `MCP_SYNC_KEY`, and optionally `JWT_SECRET`, `ST_WEBHOOK_SECRET`.
- Non-secret configuration (`ST_TENANT_ID`, `ST_ENV`, `WRITE_GATE`, `MCP_LOCKDOWN`, `MCP_SERVICE_VERSION`) lives in `wrangler.toml` as plain vars.
- **Never commit real secrets.** Use `.env` only for local placeholders. Rotate any credential that may have been exposed.

### Inbound authentication

Every `POST /mcp` request must present either:

- an `X-Sync-Key` header equal to `MCP_SYNC_KEY`, or
- an `Authorization: Bearer <JWT>` signed with `JWT_SECRET` (when configured).

Requests that fail this check are rejected before any tool executes. Admin routes (`/admin/*`) additionally require the `X-Sync-Key`.

**Hardening:**
- Use a long, random `MCP_SYNC_KEY` (treat it like a password).
- Prefer short-lived signed JWTs for multi-client deployments so individual clients can be revoked without rotating the shared key.
- Put the Worker behind additional network controls (e.g. Cloudflare Access / WAF rules) if you do not need it publicly reachable.

### Write-gate (two-phase writes)

State-changing tools require a two-phase `dryRun → confirm` flow:

1. The first call returns a preview and a short-lived **HMAC confirmation token** bound to the request shape — no write occurs.
2. The write only happens when the tool is re-invoked with `dryRun: false` and a valid, unexpired token.

This prevents accidental or model-hallucinated mutations. The gate is **on by default**; `WRITE_GATE=off` disables it. Leave it on in production.

### Lockdown mode

Setting `MCP_LOCKDOWN=true` forces the server fully read-only: every write tool and the admin `st_call` gateway are removed from the catalog regardless of caller role or `WRITE_GATE`. Use this for analytics-only or audit deployments.

### Least-privilege ServiceTitan scopes

Grant your ServiceTitan app only the API scopes the tools you actually use require. Do not enable write scopes for a read-only deployment. The narrower the granted scope, the smaller the blast radius if the Worker's secrets are compromised.

### Audit logging & PII redaction

Every tool call (and every error) is recorded to your own D1 `audit_log` / `error_log`. Audit records are designed to capture *who called what, when, and the outcome* without persisting sensitive payloads — request fields recognized as personally identifiable (e.g. contact details) are redacted before they are written. Treat the D1 database as sensitive and restrict access to it.

### Rate limiting

A Durable Object enforces per-ServiceTitan-endpoint-family rate limiting. This protects your ServiceTitan API quota and provides a throttle against a misbehaving or abusive client. Tune limits to your tenant's quota.

### Transport security

All traffic terminates over TLS at the Cloudflare edge (`https://`). Do not deploy or proxy the Worker over plaintext HTTP. Client configuration should always use `https://` URLs.

### Webhook verification

If you enable `POST /webhooks/st`, inbound webhooks are verified with an HMAC-SHA256 signature using `ST_WEBHOOK_SECRET`. Requests that fail verification are rejected. Keep this secret out of source and rotate it on suspicion of exposure.

---

## Operator checklist

- [ ] `MCP_SYNC_KEY` is long and random; rotated on staff changes.
- [ ] ServiceTitan app is scoped to least privilege; write scopes only if needed.
- [ ] `WRITE_GATE` is `on` in production.
- [ ] `MCP_LOCKDOWN=true` for any deployment that should never write.
- [ ] D1 database access is restricted; audit logs reviewed periodically.
- [ ] Secrets are set via `wrangler secret put`, never committed.
- [ ] `npm run security:audit` (or `npm audit`) run on dependency updates.
- [ ] Worker reachable only by intended clients (network controls in place).

---

## Dependencies

Run `npm run security:audit` to check production dependencies for known advisories. Keep `@modelcontextprotocol/sdk`, the Agents SDK, and `wrangler` current.
