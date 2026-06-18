// ============================================================
// env.ts — Typed environment bindings for servicetitan-mcp
// ============================================================

export interface Env {
  // ── Bindings ──────────────────────────────────────────────
  DB: D1Database; // own database: audit_log, error_log, mcp_roles, confirmation_tokens, mcp_cache
  MCP_METRICS?: AnalyticsEngineDataset; // optional p50/p95/p99 + error-rate timeseries
  PROXY_STATE?: KVNamespace; // optional heartbeat / shared-state KV
  /**
   * ServiceTitan backend. Injected in-process at the request boundary by
   * createDirectBackend(env) — NOT a wrangler service binding. The tool layer
   * addresses it as a Fetcher; see src/backend/direct.ts.
   */
  ST_PROXY: Fetcher;

  // ── Vars ──────────────────────────────────────────────────
  MCP_SERVICE_VERSION: string;
  ST_TENANT_ID: string; // your ServiceTitan tenant id
  ST_ENV?: 'production' | 'integration'; // ServiceTitan API environment (default: production)
  WRITE_GATE?: string; // "off" disables the dryRun→confirm gate (default: on)
  MCP_LOCKDOWN?: string; // "true" → read-only mode (strips writes + admin tools)

  // ── Secrets ───────────────────────────────────────────────
  // ServiceTitan app credentials (create an app in Developer Portal → Settings):
  ST_CLIENT_ID: string;
  ST_CLIENT_SECRET: string;
  ST_APP_KEY: string;
  // Inbound auth — clients present this as X-Sync-Key (or a JWT signed with JWT_SECRET):
  MCP_SYNC_KEY: string;
  MCP_SYNC_KEY_2?: string; // optional rotation overlap (accepted alongside MCP_SYNC_KEY)
  JWT_SECRET?: string; // optional: HS256 signing secret for JWT client auth
  ST_WEBHOOK_SECRET?: string; // optional: ServiceTitan webhook HMAC-SHA256 secret

  // ── Durable Objects ───────────────────────────────────────
  ST_RATE_LIMITER: DurableObjectNamespace;
  CUSTOMER_SNAPSHOT_FLIGHT: DurableObjectNamespace;
}
