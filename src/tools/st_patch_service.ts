// ============================================================
// st_patch_service — PATCH a pricebook service by ID
// F3: dryRun=true (default) → confirmation_token → dryRun=false → durable write.
// ============================================================

import { z } from 'zod';
import type { Env } from '../env';
import { authHeaders } from '../auth';
import { BACKEND_ORIGIN } from '../backend/direct';
import { McpError, mapUpstreamStatus } from '../errors';
import { WriteGate } from '../write-gate';
import type { ToolDef } from './index';
import { toStPricebookPayload } from './pricebook-payload';

interface Args {
  id: number;
  name?: string;
  code?: string;
  description?: string;
  cost?: number;
  price?: number;
  memberPrice?: number;
  useStaticPrices?: boolean;
  hours?: number;
  isLabor?: boolean;
  taxable?: boolean;
  account?: string;
  paysCommission?: boolean;
  active?: boolean;
  categoryId?: number;
  categories?: number[];
  dryRun?: boolean;
  confirmation_token?: string;
}

export const st_patch_service: ToolDef<Args> = {
  name: 'st_patch_service',
  description:
    'PATCH a ServiceTitan pricebook service by ID. ' +
    'dryRun=true (default) validates and returns a confirmation_token — call again with dryRun=false + token to write. ' +
    'If your tenant uses dynamic pricing, do NOT set price/memberPrice unless this is a static-price service. ' +
    'Note: useStaticPrices cannot be flipped from false→true via PATCH on a service that was created without it (ServiceTitan silently drops the change). Use the ServiceTitan UI to flip it.',
  isWrite: true,
  stEndpoint: { method: 'PATCH', path: '/pricebook/v2/tenant/{tid}/services/{id}', source: 'live' },
  zodSchema: {
    id: z.number().int().positive().describe('ST pricebook service ID'),
    name: z.string().optional().describe('Display name (rewritten to displayName before submit)'),
    code: z.string().optional().describe('Service code (e.g. "HVAC-DIAG-01")'),
    description: z.string().optional().describe('Service description shown on invoices'),
    cost: z.number().optional().describe('Internal cost (required for correct job costing)'),
    price: z.number().optional().describe('Static price. Only meaningful when useStaticPrices=true.'),
    memberPrice: z.number().optional().describe('Member-tier static price. Only meaningful when useStaticPrices=true.'),
    useStaticPrices: z.boolean().optional().describe('Plural — the field ST actually accepts. CAN ONLY BE FLIPPED via UI post-create — PATCH attempts silently drop.'),
    hours: z.number().optional().describe('Labor hours (used for cost calc on isLabor=true services)'),
    isLabor: z.boolean().optional().describe('true = labor line item; false = part/equipment/fee'),
    taxable: z.boolean().optional().describe('Whether the service is taxable'),
    account: z.string().optional().describe('GL account name (e.g. "Revenue")'),
    paysCommission: z.boolean().optional().describe('Whether commission applies on sale'),
    active: z.boolean().optional().describe('Whether the service is active in the pricebook'),
    categoryId: z.number().int().positive().optional().describe('Pricebook category ID (single-cat shortcut; pass categories[] for multi-cat)'),
    categories: z.array(z.number().int().positive()).min(1).optional().describe('Multi-category. If passed, takes precedence over categoryId.'),
    dryRun: z.boolean().default(true).describe('true (default) = preview + token; false = execute write'),
    confirmation_token: z.string().optional().describe('Token from prior dryRun=true call, required when dryRun=false'),
  },
  async handler(env, args, { actor, correlation }) {
    const { id, dryRun = true, confirmation_token, ...payload } = args;
    if (Object.keys(payload).length === 0) {
      throw new McpError('validation_error', 'st_patch_service requires at least one field to update besides id', { correlation });
    }
    const businessArgs = { id, ...payload };
    const stPayload = toStPricebookPayload(payload);
    const gate = new WriteGate(env);
    const endpoint = `/pricebook/v2/tenant/000000000/services/${id}`;

    if (dryRun) {
      return gate.dryRun('st_patch_service', businessArgs, actor, correlation, stPayload, endpoint, 'PATCH', 5 * 60 * 1000);
    }
    if (!confirmation_token) {
      throw new McpError('validation_error', 'confirmation_token required when dryRun=false', { correlation });
    }
    await gate.verifyToken('st_patch_service', businessArgs, actor, confirmation_token);
    return durableWrite(env, { actor, operation: 'service.patch', target: { id: String(id), type: 'service' }, payload: stPayload, correlation });
  },
};

// ─── Shared pricebook write helper (used by all 4 pricebook write tools) ──────
// Maps a logical operation to its ServiceTitan endpoint + method and performs a
// single direct write through the in-process backend.
interface PricebookWriteOpts {
  actor: string;
  operation: 'service.create' | 'service.patch' | 'material.create' | 'material.patch' | string;
  target: { id: string; type?: string };
  payload: unknown;
  correlation: string;
}

const OP_ROUTES: Record<string, { method: 'POST' | 'PATCH'; build: (id: string) => string }> = {
  'service.create': { method: 'POST', build: () => `/pricebook/v2/tenant/000000000/services` },
  'service.patch': { method: 'PATCH', build: (id) => `/pricebook/v2/tenant/000000000/services/${id}` },
  'material.create': { method: 'POST', build: () => `/pricebook/v2/tenant/000000000/materials` },
  'material.patch': { method: 'PATCH', build: (id) => `/pricebook/v2/tenant/000000000/materials/${id}` },
};

export async function durableWrite(env: Env, opts: PricebookWriteOpts): Promise<unknown> {
  const { actor, operation, target, payload, correlation } = opts;
  const route = OP_ROUTES[operation];
  if (!route) {
    throw new McpError('validation_error', `unknown pricebook write operation: ${operation}`, { correlation });
  }
  const endpoint = route.build(target.id);

  const resp = await env.ST_PROXY.fetch(`${BACKEND_ORIGIN}/api/st/write`, {
    method: 'POST',
    headers: { ...authHeaders(env, correlation, actor), 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, method: route.method, payload }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new McpError(
      mapUpstreamStatus(resp.status),
      `${operation} write failed ${resp.status}: ${body.slice(0, 200)}`,
      { correlation },
    );
  }
  return { ok: true, operation, result: await resp.json() };
}
