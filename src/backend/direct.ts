// ============================================================
// backend/direct.ts — in-process ServiceTitan backend.
//
// The tool layer was originally written against a remote "proxy" worker that
// held ServiceTitan OAuth and a synced D1 mirror, addressed via a service
// binding (env.ST_PROXY) at the virtual origin below. This module provides a
// drop-in `Fetcher` that implements the SAME wire contract entirely
// in-process, talking DIRECTLY to the ServiceTitan API (OAuth client
// credentials) and to this worker's OWN D1. Inject it as env.ST_PROXY at the
// request boundary and every existing read/write/pagination/rate-limit helper
// keeps working unchanged.
//
// Virtual routes served (no network hop — dispatched on pathname only):
//   GET|POST /api/st/read?endpoint=<ST path>   → live ServiceTitan read
//   POST     /api/st/write {endpoint,method,payload} → live ServiceTitan write
//   POST     /api/sql/read {sql,params}        → local D1 SELECT  ({success,results})
//   POST     /internal/query-d1 {sql,params}   → local D1 SELECT  ({rows,updatedAt})
// ============================================================

import type { Env } from '../env';
import { getAccessToken } from './oauth';
import { rewriteTenantPlaceholders } from '../tenant';

/** Virtual origin the tool layer addresses the backend by. No network hop. */
export const BACKEND_ORIGIN = 'https://st-backend.internal';

function apiBase(env: Env): string {
  return env.ST_ENV === 'integration'
    ? 'https://api-integration.servicetitan.io'
    : 'https://api.servicetitan.io';
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Build the auth headers every ServiceTitan API call needs. */
async function stHeaders(env: Env, extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getAccessToken(env);
  return {
    Authorization: `Bearer ${token}`,
    'ST-App-Key': env.ST_APP_KEY,
    Accept: 'application/json',
    ...extra,
  };
}

// ── ServiceTitan reads ────────────────────────────────────────
async function handleRead(env: Env, req: Request, url: URL): Promise<Response> {
  const endpoint = url.searchParams.get('endpoint');
  if (!endpoint) return json({ error: 'backend: missing endpoint param' }, 400);
  const path = rewriteTenantPlaceholders(env, endpoint);
  const target = `${apiBase(env)}${path}`;

  const method = req.method === 'POST' ? 'POST' : 'GET';
  const init: RequestInit =
    method === 'POST'
      ? {
          method: 'POST',
          headers: await stHeaders(env, { 'content-type': 'application/json' }),
          body: await req.text(),
        }
      : { method: 'GET', headers: await stHeaders(env) };

  // Pass the ServiceTitan response through unchanged — status, body, and
  // Retry-After all matter to the upstream helpers (rate-limit + pagination).
  return fetch(target, init);
}

// ── ServiceTitan writes ───────────────────────────────────────
async function handleWrite(env: Env, req: Request): Promise<Response> {
  const { endpoint, method, payload } = (await req.json()) as {
    endpoint: string;
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    payload?: unknown;
  };
  const path = rewriteTenantPlaceholders(env, endpoint);
  const target = `${apiBase(env)}${path}`;
  const hasBody = method !== 'DELETE' && payload !== undefined && payload !== null;

  return fetch(target, {
    method,
    headers: await stHeaders(env, hasBody ? { 'content-type': 'application/json' } : undefined),
    body: hasBody ? JSON.stringify(payload) : undefined,
  });
}

// ── Local D1 (this worker's own database) ─────────────────────
async function runLocalSelect(env: Env, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql)) {
    throw new Error('only SELECT/WITH statements are permitted');
  }
  const stmt = env.DB.prepare(sql).bind(...params);
  const res = await stmt.all<Record<string, unknown>>();
  return res.results ?? [];
}

// /api/sql/read contract: { success, results } | { success:false, error }
async function handleSqlRead(env: Env, req: Request): Promise<Response> {
  const { sql, params = [] } = (await req.json()) as { sql: string; params?: unknown[] };
  try {
    const results = await runLocalSelect(env, sql, params);
    return json({ success: true, results });
  } catch (e) {
    // success:false is parsed by readD1 and surfaced as the real D1 error.
    return json({ success: false, error: (e as Error).message });
  }
}

// /internal/query-d1 contract: { rows, updatedAt }.
// updatedAt is null here (no sync-metadata layer in the standalone server), which
// makes ReadRouter treat D1 freshness as unknown and fall back to live ST — the
// correct default when the operator has not populated a D1 mirror.
async function handleQueryD1(env: Env, req: Request): Promise<Response> {
  const { sql, params = [] } = (await req.json()) as { sql: string; params?: unknown[] };
  try {
    const rows = await runLocalSelect(env, sql, params);
    return json({ rows, updatedAt: null });
  } catch {
    return json({ rows: [], updatedAt: null });
  }
}

/**
 * Create the in-process ServiceTitan backend. Returns a `Fetcher` so it can be
 * injected as env.ST_PROXY without changing any call site.
 */
export function createDirectBackend(env: Env): Fetcher {
  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      const url = new URL(req.url);
      switch (url.pathname) {
        case '/api/st/read':
          return handleRead(env, req, url);
        case '/api/st/write':
          return handleWrite(env, req);
        case '/api/sql/read':
          return handleSqlRead(env, req);
        case '/internal/query-d1':
          return handleQueryD1(env, req);
        default:
          return json({ error: `backend: unknown route ${url.pathname}` }, 404);
      }
    },
  } as Fetcher;
}
