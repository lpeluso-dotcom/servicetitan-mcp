// ============================================================
// dispatch_override_audit — appointment reassignment activity over a window.
//
// HEURISTIC audit (standard ST fields only):
//   - List appointment-assignments created in the window (optionally scoped by
//     businessUnitId).
//   - Surface likely reassignments using two simple, standard-field signals:
//       1. modifiedOn > createdOn on an assignment row, AND/OR
//       2. more than one assignment row referencing the same appointmentId.
//   - Tally reassignment counts per technician and per business unit.
//
// This is explicitly a HEURISTIC. It does NOT classify "auto vs manual"
// dispatch and applies no thresholds — it only reports reassignment signals
// derivable from standard fields. Treat the counts as indicative, not exact.
// ============================================================

import { z } from 'zod';
import { readSTPaged } from '../../st';
import type { ToolDef } from '../index';

interface Args { from: string; to: string; businessUnitId?: number }

interface Assignment {
  id?: number;
  appointmentId?: number;
  technicianId?: number;
  businessUnitId?: number;
  createdOn?: string;
  modifiedOn?: string;
}

function ts(v?: string): number | null {
  if (!v) return null;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : null;
}

export const dispatch_override_audit: ToolDef<Args> = {
  name: 'dispatch_override_audit',
  description:
    'Heuristic audit of appointment-assignment reassignment activity over a date range. Flags rows where modifiedOn > createdOn and appointments with multiple assignment rows, then tallies reassignment counts per technician and business unit. Heuristic only — no auto-vs-manual classification or thresholds. Source: live ST.',
  zodSchema: {
    from: z.string().describe('Start date (inclusive), ISO date e.g. 2026-01-01'),
    to: z.string().describe('End date (inclusive), ISO date e.g. 2026-01-31'),
    businessUnitId: z.number().int().positive().optional().describe('Optional business unit filter'),
  },
  isWrite: false,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  stEndpoint: { method: 'GET', path: '/dispatch/v2/tenant/{tid}/appointment-assignments', source: 'live' },
  async handler(env, args, { actor, correlation }) {
    const query: Record<string, unknown> = {
      createdOnOrAfter: args.from,
      createdBefore: args.to,
    };
    if (args.businessUnitId) query.businessUnitIds = args.businessUnitId;

    const { rows, pagesFetched, hitCap, totalCount } = await readSTPaged<Assignment>(
      env,
      { actor, correlation },
      '/dispatch/v2/tenant/000000000/appointment-assignments',
      query,
      { maxPages: 25, pageSize: 200 },
    );

    // Count assignment rows per appointment (signal #2).
    const rowsPerAppt = new Map<number, number>();
    for (const a of rows) {
      if (typeof a?.appointmentId === 'number') {
        rowsPerAppt.set(a.appointmentId, (rowsPerAppt.get(a.appointmentId) ?? 0) + 1);
      }
    }

    const perTech = new Map<number, number>();
    const perBusinessUnit = new Map<number, number>();
    const flagged: Array<{ appointmentId: number | null; technicianId: number | null; businessUnitId: number | null; reason: string }> = [];

    for (const a of rows) {
      const created = ts(a?.createdOn);
      const modified = ts(a?.modifiedOn);
      const modifiedAfterCreate = created != null && modified != null && modified > created;
      const multipleRows =
        typeof a?.appointmentId === 'number' && (rowsPerAppt.get(a.appointmentId) ?? 0) > 1;

      if (!modifiedAfterCreate && !multipleRows) continue;

      const reason = [
        modifiedAfterCreate ? 'modifiedOn>createdOn' : null,
        multipleRows ? 'multipleAssignmentRows' : null,
      ]
        .filter(Boolean)
        .join('+');

      flagged.push({
        appointmentId: typeof a?.appointmentId === 'number' ? a.appointmentId : null,
        technicianId: typeof a?.technicianId === 'number' ? a.technicianId : null,
        businessUnitId: typeof a?.businessUnitId === 'number' ? a.businessUnitId : null,
        reason,
      });

      if (typeof a?.technicianId === 'number') {
        perTech.set(a.technicianId, (perTech.get(a.technicianId) ?? 0) + 1);
      }
      if (typeof a?.businessUnitId === 'number') {
        perBusinessUnit.set(a.businessUnitId, (perBusinessUnit.get(a.businessUnitId) ?? 0) + 1);
      }
    }

    const byTechnician = [...perTech.entries()]
      .map(([technicianId, count]) => ({ technicianId, reassignmentCount: count }))
      .sort((a, b) => b.reassignmentCount - a.reassignmentCount);
    const byBusinessUnit = [...perBusinessUnit.entries()]
      .map(([businessUnitId, count]) => ({ businessUnitId, reassignmentCount: count }))
      .sort((a, b) => b.reassignmentCount - a.reassignmentCount);

    return {
      from: args.from,
      to: args.to,
      businessUnitId: args.businessUnitId ?? null,
      assignmentRowCount: rows.length,
      reassignmentSignalCount: flagged.length,
      byTechnician,
      byBusinessUnit,
      flagged,
      _heuristic:
        'Reassignment is inferred from modifiedOn>createdOn and/or multiple assignment rows per appointment. No auto-vs-manual classification or thresholds are applied; counts are indicative.',
      _pagesFetched: pagesFetched,
      _hitCap: hitCap,
      _totalCount: totalCount,
      _source: 'live',
    };
  },
};
