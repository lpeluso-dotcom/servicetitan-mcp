// ============================================================
// membership_value_leaderboard — active-membership counts by selling tech.
//
// Computation (standard ST fields only):
//   - List active memberships (status=Active), optionally scoped by
//     businessUnitId.
//   - Group each membership by its selling technician (soldById). When soldById
//     is absent, fall back to grouping by membership type.
//   - Rank groups by membership count (descending), then by recurringServiceCount
//     (sum of recurringServiceTypes lengths) as a tiebreaker.
//
// These are PURE COUNTS off standard fields. There is no revenue, value, or
// scoring model — "value" here means membership volume, nothing more.
// ============================================================

import { z } from 'zod';
import { readSTPaged } from '../../st';
import type { ToolDef } from '../index';

interface Args { businessUnitId?: number; limit?: number }

interface Membership {
  status?: string;
  type?: string | { name?: string };
  soldById?: number;
  soldBy?: { id?: number; name?: string } | string;
  businessUnitId?: number;
  recurringServiceTypes?: unknown[];
}

interface Group {
  key: string;
  soldById: number | null;
  membershipType: string | null;
  membershipCount: number;
  recurringServiceCount: number;
}

function typeName(t: Membership['type']): string | null {
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object' && typeof t.name === 'string') return t.name;
  return null;
}

export const membership_value_leaderboard: ToolDef<Args> = {
  name: 'membership_value_leaderboard',
  description:
    'Active memberships grouped by selling technician (soldById), or by membership type when soldById is absent, ranked by membership count (recurringServiceCount as tiebreaker). Pure counts off standard ST fields — no revenue or scoring model. Source: live ST.',
  zodSchema: {
    businessUnitId: z.number().int().positive().optional().describe('Optional business unit filter'),
    limit: z.number().int().positive().max(200).default(20).describe('Max groups to return (default 20)'),
  },
  isWrite: false,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  stEndpoint: { method: 'GET', path: '/memberships/v2/tenant/{tid}/memberships', source: 'live' },
  async handler(env, args, { actor, correlation }) {
    const limit = args.limit ?? 20;
    const query: Record<string, unknown> = { status: 'Active' };
    if (args.businessUnitId) query.businessUnitId = args.businessUnitId;

    const { rows, pagesFetched, hitCap, totalCount } = await readSTPaged<Membership>(
      env,
      { actor, correlation },
      '/memberships/v2/tenant/000000000/memberships',
      query,
      { maxPages: 25, pageSize: 200 },
    );

    // ST status filter can be unreliable — re-filter to Active client-side.
    const active = rows.filter((m) => m?.status == null || m.status === 'Active');

    const groups = new Map<string, Group>();
    for (const m of active) {
      const soldById =
        typeof m?.soldById === 'number'
          ? m.soldById
          : m?.soldBy && typeof m.soldBy === 'object' && typeof m.soldBy.id === 'number'
            ? m.soldBy.id
            : null;
      const tName = typeName(m?.type);
      const key = soldById != null ? `tech:${soldById}` : `type:${tName ?? 'unknown'}`;

      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          soldById,
          membershipType: soldById != null ? null : tName,
          membershipCount: 0,
          recurringServiceCount: 0,
        };
        groups.set(key, g);
      }
      g.membershipCount += 1;
      if (Array.isArray(m?.recurringServiceTypes)) {
        g.recurringServiceCount += m.recurringServiceTypes.length;
      }
    }

    const leaderboard = [...groups.values()]
      .sort(
        (a, b) =>
          b.membershipCount - a.membershipCount ||
          b.recurringServiceCount - a.recurringServiceCount,
      )
      .slice(0, limit);

    return {
      businessUnitId: args.businessUnitId ?? null,
      groupedBy: 'soldById (falls back to membership type when soldById absent)',
      activeMembershipCount: active.length,
      groupCount: groups.size,
      leaderboard,
      _pagesFetched: pagesFetched,
      _hitCap: hitCap,
      _totalCount: totalCount,
      _source: 'live',
    };
  },
};
