// ============================================================
// job_cost_actuals — per-job actuals from standard ST fields.
//
// For a single jobId:
//   - revenue      = sum of invoice.total across the job's invoice(s).
//   - materialCost = sum of invoice line-item.cost where item.type indicates a
//                    material, ONLY where ST exposes item.cost; null if no
//                    material line item carried a cost.
//   - laborHours   = sum of job-timesheet hours.
//
// IMPORTANT: this reports labor HOURS only. It deliberately does NOT compute a
// labor dollar cost or any overhead/loaded rate — there is no cost-rate model
// here. Material cost is limited to whatever ST itself puts on item.cost.
// ============================================================

import { z } from 'zod';
import { readST, readSTPaged } from '../../st';
import type { ToolDef } from '../index';

interface Args { jobId: number }

interface InvoiceItem { total?: number; cost?: number; quantity?: number; type?: string }
interface Invoice { total?: number; items?: InvoiceItem[] }
interface Timesheet { hours?: number; startedOn?: string }

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isMaterial(type?: string): boolean {
  return typeof type === 'string' && /material/i.test(type);
}

export const job_cost_actuals: ToolDef<Args> = {
  name: 'job_cost_actuals',
  description:
    'Per-job actuals from standard ST fields: revenue (sum of invoice totals), materialCost (sum of invoice item.cost where the item type is a material; null if none carry cost), and laborHours (sum of job timesheet hours). Reports labor HOURS only — no labor-dollar or loaded-rate model. Source: live ST.',
  zodSchema: {
    jobId: z.number().int().positive().describe('ST job ID'),
  },
  isWrite: false,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  stEndpoint: { method: 'GET', path: '/jpm/v2/tenant/{tid}/jobs/{id}', source: 'mixed' },
  async handler(env, args, { actor, correlation }) {
    const ctx = { actor, correlation };
    const jobId = args.jobId;

    // Invoices for the job (list envelope).
    const invResp = await readST<{ data?: Invoice[] }>(
      env,
      ctx,
      '/accounting/v2/tenant/000000000/invoices',
      { jobId },
    );
    const invoices = invResp?.data ?? [];

    // Job timesheets — hours only.
    let timesheets: Timesheet[] = [];
    try {
      const ts = await readSTPaged<Timesheet>(
        env,
        ctx,
        `/payroll/v2/tenant/000000000/jobs/${jobId}/timesheets`,
        {},
        { maxPages: 10, pageSize: 200 },
      );
      timesheets = ts.rows;
    } catch {
      // Timesheets endpoint unavailable for this job — report hours as null below.
      timesheets = [];
    }

    let revenue = 0;
    let materialCost = 0;
    let materialItemsWithCost = 0;
    for (const inv of invoices) {
      revenue += num(inv?.total);
      for (const item of inv?.items ?? []) {
        if (item != null && isMaterial(item.type) && item.cost != null && Number.isFinite(Number(item.cost))) {
          materialCost += num(item.cost) * (item.quantity != null ? num(item.quantity) : 1);
          materialItemsWithCost += 1;
        }
      }
    }

    const laborHours = timesheets.reduce((sum, t) => sum + num(t?.hours), 0);

    return {
      jobId,
      revenue,
      invoiceCount: invoices.length,
      materialCost: materialItemsWithCost > 0 ? materialCost : null,
      laborHours: timesheets.length > 0 ? laborHours : null,
      _note:
        'materialCost includes only material line items where ST exposes item.cost. laborHours is hours only — no labor-dollar or loaded-rate cost is computed.',
      _materialItemsWithCost: materialItemsWithCost,
      _timesheetRows: timesheets.length,
      _source: 'live',
    };
  },
};
