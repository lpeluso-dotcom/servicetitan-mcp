// ============================================================
// open_opportunities_feed — generic open-opportunity follow-up feed.
//
// Computation (standard ST fields only):
//   - List opportunities, optionally scoped by businessUnitId.
//   - Keep only opportunities whose status is NOT a closed/won/dismissed state
//     (case-insensitive match against a small generic set of terminal terms).
//   - Sort by followUpDate ascending (oldest first); rows without a followUpDate
//     fall back to createdOn, and sort after rows that have a followUpDate.
//   - Return id, status, followUpDate, businessUnitId, customerId per row,
//     plus a count.
//
// A generic sales-followup view. No scoring, prioritization model, or
// org-specific status names — just standard fields and a sort.
// ============================================================

import { z } from 'zod';
import { readSTPaged } from '../../st';
import type { ToolDef } from '../index';

interface Args { businessUnitId?: number; limit?: number }

interface Opportunity {
  id?: number;
  status?: string | { name?: string };
  followUpDate?: string;
  createdOn?: string;
  modifiedOn?: string;
  businessUnitId?: number;
  customerId?: number;
}

// Generic terminal states — any status containing one of these terms is treated
// as not-open. Substring match keeps it resilient to ST status label variants.
const TERMINAL_TERMS = ['closed', 'won', 'lost', 'dismiss', 'cancel', 'complete'];

function statusName(s: Opportunity['status']): string {
  if (typeof s === 'string') return s;
  if (s && typeof s === 'object' && typeof s.name === 'string') return s.name;
  return '';
}

function isOpen(s: Opportunity['status']): boolean {
  const name = statusName(s).toLowerCase();
  if (!name) return true; // unknown/blank status — treat as open rather than drop
  return !TERMINAL_TERMS.some((term) => name.includes(term));
}

function sortKey(o: Opportunity): number {
  const d = o?.followUpDate ?? o?.createdOn;
  if (!d) return Number.POSITIVE_INFINITY; // no date — sort last
  const n = Date.parse(d);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export const open_opportunities_feed: ToolDef<Args> = {
  name: 'open_opportunities_feed',
  description:
    'Lists opportunities whose status is not a closed/won/dismissed state, sorted by followUpDate ascending (oldest first; falls back to createdOn). Returns id, status, followUpDate, businessUnitId, customerId per row plus a count. Generic sales-followup view — no scoring model. Source: live ST.',
  zodSchema: {
    businessUnitId: z.number().int().positive().optional().describe('Optional business unit filter'),
    limit: z.number().int().positive().max(500).default(50).describe('Max opportunities to return (default 50)'),
  },
  isWrite: false,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  stEndpoint: { method: 'GET', path: '/sales/v2/tenant/{tid}/opportunities', source: 'live' },
  async handler(env, args, { actor, correlation }) {
    const limit = args.limit ?? 50;
    const query: Record<string, unknown> = {};
    if (args.businessUnitId) query.businessUnitId = args.businessUnitId;

    const { rows, pagesFetched, hitCap, totalCount } = await readSTPaged<Opportunity>(
      env,
      { actor, correlation },
      '/sales/v2/tenant/000000000/opportunities',
      query,
      { maxPages: 25, pageSize: 200 },
    );

    const open = rows.filter((o) => isOpen(o?.status));
    open.sort((a, b) => sortKey(a) - sortKey(b));

    const feed = open.slice(0, limit).map((o) => ({
      id: typeof o?.id === 'number' ? o.id : null,
      status: statusName(o?.status) || null,
      followUpDate: o?.followUpDate ?? null,
      businessUnitId: typeof o?.businessUnitId === 'number' ? o.businessUnitId : null,
      customerId: typeof o?.customerId === 'number' ? o.customerId : null,
    }));

    return {
      businessUnitId: args.businessUnitId ?? null,
      openCount: open.length,
      returned: feed.length,
      opportunities: feed,
      _sort: 'followUpDate ascending, falling back to createdOn; undated rows last',
      _pagesFetched: pagesFetched,
      _hitCap: hitCap,
      _totalCount: totalCount,
      _source: 'live',
    };
  },
};
