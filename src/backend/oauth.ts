// ============================================================
// backend/oauth.ts — ServiceTitan OAuth 2.0 client-credentials.
//
// Mints and caches an access token for the ServiceTitan API. The token is
// cached in module scope for the lifetime of the isolate and refreshed ~60s
// before expiry. This is the standard machine-to-machine flow described in the
// ServiceTitan developer docs — each operator brings their own app credentials
// (ST_CLIENT_ID / ST_CLIENT_SECRET) and tenant.
// ============================================================

import type { Env } from '../env';

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
  clientId: string; // guards against a credential swap reusing a stale token
}

let cache: TokenCache | null = null;

function authBase(env: Env): string {
  return env.ST_ENV === 'integration'
    ? 'https://auth-integration.servicetitan.io'
    : 'https://auth.servicetitan.io';
}

/**
 * Return a valid ServiceTitan API access token, minting a new one if the cache
 * is empty, near expiry, or was issued for a different client_id.
 */
export async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cache && cache.clientId === env.ST_CLIENT_ID && now < cache.expiresAt - 60_000) {
    return cache.token;
  }

  const resp = await fetch(`${authBase(env)}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.ST_CLIENT_ID,
      client_secret: env.ST_CLIENT_SECRET,
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`ServiceTitan OAuth token request failed: ${resp.status} ${detail.slice(0, 200)}`);
  }

  const data = (await resp.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('ServiceTitan OAuth response missing access_token');
  }

  cache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 900) * 1000,
    clientId: env.ST_CLIENT_ID,
  };
  return cache.token;
}

/** Test seam — clears the in-isolate token cache. */
export function __resetTokenCache(): void {
  cache = null;
}
