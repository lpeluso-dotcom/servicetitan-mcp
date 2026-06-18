// ============================================================
// margin_audit — generic revenue/margin summary over a date range.
//
// Computation (standard ST fields only):
//   - Pull invoices for the window (filter by businessUnitId if given).
//   - revenue   = sum of invoice.total across the window.
//   - cost      = sum of invoice line-item.cost ONLY where ST exposes a cost
//                 on the item. Items without a cost field are not counted —
//                 there is NO synthetic/derived cost model here.
//   - margin    = revenue - cost (over the cost-bearing portion only).
//   - marginPct = margin / revenue (null when revenue is 0).
//
// Cost is therefore PARTIAL by design: it reflects only the line items where
// ServiceTitan itself provides item.cost. The result labels this explicitly so
// callers don't read the figure as a full cost of goods.
// ============================================================

import { z } from 'zod';
import { readSTPaged } from '../../st';
import type { ToolDef } from '../index';

interface Args { from: string; to: string; businessUnitId?: number }

interface InvoiceItem { total?: number; cost?: number; quantity?: number; type?: string }
interface Invoice { total?: number; subtotal?: number; items?: InvoiceItem[] }

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const margin_audit: ToolDef<Args> = {
  name: 'margin_audit',
  description:
    'Generic revenue/margin summary over a date range. Sums invoice.total for revenue and, where ST exposes line-item cost, sums those costs (cost is partial — only items that carry a cost field). Reports revenue, cost, grossMargin, marginPct, invoiceCount. Source: live ST.',
  zodSchema: {
    from: z.string().describe('Start date (inclusive), ISO date e.g. 2026-01-01'),
    to: z.string().describe('End date (inclusive), ISO date e.g. 2026-01-31'),
    businessUnitId: z.number().int().positive().optional().describe('Optional business unit filter'),
  },
  isWrite: false,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  stEndpoint: { method: 'GET', path: '/accounting/v2/tenant/{tid}/invoices', source: 'mixed' },
  async handler(env, args, { actor, correlation }) {
    const query: Record<string, unknown> = {
      invoicedOnOrAfter: args.from,
      invoicedOnOrBefore: args.to,
    };
    if (args.businessUnitId) query.businessUnitIds = args.businessUnitId;

    const { rows, pagesFetched, hitCap, totalCount } = await readSTPaged<Invoice>(
      env,
      { actor, correlation },
      '/accounting/v2/tenant/000000000/invoices',
      query,
      { maxPages: 25, pageSize: 200 },
    );

    let revenue = 0;
    let cost = 0;
    let itemsWithCost = 0;
    for (const inv of rows) {
      revenue += num(inv?.total);
      for (const item of inv?.items ?? []) {
        if (item != null && item.cost != null && Number.isFinite(Number(item.cost))) {
          cost += num(item.cost) * (item.quantity != null ? num(item.quantity) : 1);
          itemsWithCost += 1;
        }
      }
    }

    const grossMargin = revenue - cost;
    const marginPct = revenue > 0 ? grossMargin / revenue : null;

    return {
      from: args.from,
      to: args.to,
      businessUnitId: args.businessUnitId ?? null,
      invoiceCount: rows.length,
      revenue,
      cost,
      grossMargin,
      marginPct,
      _costNote:
        'cost is partial: only invoice line items where ServiceTitan exposes item.cost are included. No synthetic cost model is applied.',
      _itemsWithCost: itemsWithCost,
      _pagesFetched: pagesFetched,
      _hitCap: hitCap,
      _totalCount: totalCount,
      _source: 'live',
    };
  },
};
