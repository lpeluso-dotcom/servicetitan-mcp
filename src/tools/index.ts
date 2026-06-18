// ============================================================
// tools/index.ts — Tool registry
// Generic ServiceTitan API tool surface (reads + writes) plus a small set
// of generic composites. Each tool maps to a standard ServiceTitan API call.
// ============================================================

import type { z } from 'zod';
import type { Env } from '../env';
// Legacy thin wrappers
import { st_list_customers } from './st_list_customers';
import { st_get_customer } from './st_get_customer';
import { st_list_jobs } from './st_list_jobs';
import { st_list_appointments } from './st_list_appointments';
import { st_get_pricebook } from './st_get_pricebook';
import { st_patch_service } from './st_patch_service';
import { st_create_service } from './st_create_service';
import { st_patch_material } from './st_patch_material';
import { st_create_material } from './st_create_material';
// CRM
import { find_customer } from './crm/find_customer';
import { get_customer } from './crm/get_customer';
import { get_customer_locations } from './crm/get_customer_locations';
import { list_customer_jobs } from './crm/list_customer_jobs';
import { get_customer_membership } from './crm/get_customer_membership';
import { add_customer_note } from './crm/add_customer_note';
// Pricebook
import { search_pricebook_services } from './pricebook/search_pricebook_services';
import { get_service_details } from './pricebook/get_service_details';
import { search_materials } from './pricebook/search_materials';
import { get_configurable_equipment_children } from './pricebook/get_configurable_equipment_children';
import { list_service_categories } from './pricebook/list_service_categories';
import { search_pricebook_all } from './pricebook/search_pricebook_all';
// Composites (generic only)
import { customer_snapshot } from './composites/customer_snapshot';
import { margin_audit } from './composites/margin_audit';
import { job_cost_actuals } from './composites/job_cost_actuals';
import { membership_value_leaderboard } from './composites/membership_value_leaderboard';
import { dispatch_override_audit } from './composites/dispatch_override_audit';
import { open_opportunities_feed } from './composites/open_opportunities_feed';
// Admin raw gateway
import { st_call } from './st_call';
// Memberships
import { list_memberships_active } from './memberships/list_memberships_active';
import { list_memberships_expiring } from './memberships/list_memberships_expiring';
import { create_recurring_service } from './memberships/create_recurring_service';
// Calls & Forms
import { get_call } from './calls_forms/get_call';
import { get_form_submission } from './calls_forms/get_form_submission';
// Tasks
import { create_task } from './tasks/create_task';
import { list_open_tasks } from './tasks/list_open_tasks';
// Estimates
import { list_estimates_job } from './estimates/list_estimates_job';
import { get_estimate } from './estimates/get_estimate';
import { dismiss_estimate, sell_estimate, unsell_estimate } from './estimates/update_estimate_status';
// Dispatch
import { get_capacity } from './dispatch/get_capacity';
import { list_technicians_available } from './dispatch/list_technicians_available';
import { get_technician_shifts } from './dispatch/get_technician_shifts';
import { list_non_job_events } from './dispatch/list_non_job_events';
import { st_get_capacity_slots } from './dispatch/st_get_capacity_slots';
// Marketing
import { list_campaigns } from './marketing/list_campaigns';
import { get_campaign_performance } from './marketing/get_campaign_performance';
import { create_call_with_campaign } from './marketing/create_call_with_campaign';
// Reporting (mode discriminator)
import { st_run_report } from './reporting/st_run_report';
// Invoicing
import { get_invoice } from './invoicing/get_invoice';
import { list_invoices_job } from './invoicing/list_invoices_job';
import { get_invoice_balance } from './invoicing/get_invoice_balance';
import { list_unpaid_invoices } from './invoicing/list_unpaid_invoices';
// Jobs & Appointments
import { get_job } from './jobs/get_job';
import { list_jobs_today } from './jobs/list_jobs_today';
import { get_job_appointments } from './jobs/get_job_appointments';
import { add_job_note } from './jobs/add_job_note';
import { book_job } from './jobs/book_job';
import { reschedule_appointment } from './jobs/reschedule_appointment';
import { hold_appointment } from './jobs/hold_appointment';
import { assign_technicians } from './jobs/assign_technicians';
import { jobs_hold_reasons_list } from './jobs/jobs_hold_reasons_list';
// Inventory
import { inventory_vendors_list } from './inventory/inventory_vendors_list';
import { inventory_warehouses_list } from './inventory/inventory_warehouses_list';
import { inventory_receipts_list } from './inventory/inventory_receipts_list';
import { inventory_transfers_list } from './inventory/inventory_transfers_list';
// Payroll
import { payroll_payrolls_list } from './payroll/payroll_payrolls_list';
import { payroll_non_job_timesheets_list } from './payroll/payroll_non_job_timesheets_list';
import { payroll_job_timesheets_list } from './payroll/payroll_job_timesheets_list';
import { payroll_location_rates_list } from './payroll/payroll_location_rates_list';
import { payroll_settings_get } from './payroll/payroll_settings_get';
// Opportunities
import { opportunities_list } from './opportunities/opportunities_list';
import { opportunity_get } from './opportunities/opportunity_get';
// Dispatch Pro (D1 mirrors of native ST reports)
import { dispatch_pro_utilization_list } from './dispatch-pro/dispatch_pro_utilization_list';
import { dispatch_pro_ratio_list } from './dispatch-pro/dispatch_pro_ratio_list';
import { dispatch_pro_alerts_list } from './dispatch-pro/dispatch_pro_alerts_list';

export interface ToolContext {
  actor: string;
  correlation: string;
}

/**
 * MCP tool annotations (per the MCP spec) — hints clients use to reason about
 * a tool's effects. All four are advisory.
 */
export interface ToolAnnotations {
  /** Tool does not modify any state (pure read). */
  readOnlyHint?: boolean;
  /** Tool may perform irreversible/destructive updates. Only meaningful when readOnlyHint is false. */
  destructiveHint?: boolean;
  /** Repeated calls with the same args have no additional effect. */
  idempotentHint?: boolean;
  /** Tool interacts with an external/open world (the ServiceTitan API). */
  openWorldHint?: boolean;
}

/**
 * Optional descriptor declaring which ServiceTitan endpoint a tool maps to.
 * Used by /admin/endpoints to inventory ST coverage and detect gaps.
 *
 * source semantics:
 *   - 'live'     — every call hits the live ServiceTitan API
 *   - 'd1'       — D1-first read via read-router (live ST only on miss/stale)
 *   - 'mixed'    — composite/fanout that touches both D1 and live ST
 *   - 'computed' — synthetic/derived (no single canonical ST endpoint)
 */
export interface StEndpointDescriptor {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Templated path with {placeholders}. Tenant segment optional — st-path-builder injects. */
  path: string;
  source: 'live' | 'd1' | 'mixed' | 'computed';
}

export interface ToolDef<Args = Record<string, unknown>> {
  name: string;
  description: string;
  /** Zod raw shape — record of field name to ZodType. SDK derives JSON schema. */
  zodSchema: z.ZodRawShape;
  /** True for tools that modify state (writes). Informs registry + role checks + the write-gate. */
  isWrite?: boolean;
  /** True for tools only registered when caller role === 'admin'. */
  adminOnly?: boolean;
  /** MCP tool annotations. If omitted, registry derives sensible defaults from isWrite. */
  annotations?: ToolAnnotations;
  /** Optional ST endpoint descriptor — populated for tools that map to a single ST API call. */
  stEndpoint?: StEndpointDescriptor;
  handler: (env: Env, args: Args, ctx: ToolContext) => Promise<unknown>;
  /**
   * Optional response shaper applied AFTER handler returns and BEFORE
   * audit/serialize. Use it to strip ST noise (`paginationToken`, `_meta`),
   * cap big arrays, or abbreviate verbose keys. See src/response-shape.ts.
   */
  transformResult?: (result: unknown) => unknown;
}

export const TOOLS: readonly ToolDef<any>[] = [
  // Legacy thin wrappers
  st_list_customers, st_get_customer, st_list_jobs, st_list_appointments, st_get_pricebook,
  st_patch_service, st_create_service, st_patch_material, st_create_material,
  // CRM
  find_customer, get_customer, get_customer_locations, list_customer_jobs,
  get_customer_membership, add_customer_note,
  // Jobs
  get_job, list_jobs_today, get_job_appointments, add_job_note,
  book_job, reschedule_appointment, hold_appointment, assign_technicians, jobs_hold_reasons_list,
  // Pricebook
  search_pricebook_services, get_service_details, search_materials,
  get_configurable_equipment_children, list_service_categories,
  search_pricebook_all,
  // Invoicing
  get_invoice, list_invoices_job, get_invoice_balance, list_unpaid_invoices,
  // Estimates
  list_estimates_job, get_estimate, dismiss_estimate, sell_estimate, unsell_estimate,
  // Dispatch
  get_capacity, list_technicians_available, get_technician_shifts, list_non_job_events,
  st_get_capacity_slots,
  // Marketing
  list_campaigns, get_campaign_performance, create_call_with_campaign,
  // Reporting
  st_run_report,
  // Memberships
  list_memberships_active, list_memberships_expiring, create_recurring_service,
  // Calls & Forms
  get_call, get_form_submission,
  // Tasks
  create_task, list_open_tasks,
  // Admin gateway (adminOnly — omitted for default role)
  st_call,
  // Composites (generic)
  customer_snapshot, margin_audit, job_cost_actuals, membership_value_leaderboard,
  dispatch_override_audit, open_opportunities_feed,
  // Inventory
  inventory_vendors_list, inventory_warehouses_list, inventory_receipts_list, inventory_transfers_list,
  // Payroll
  payroll_payrolls_list, payroll_non_job_timesheets_list, payroll_job_timesheets_list, payroll_location_rates_list, payroll_settings_get,
  // Opportunities
  opportunities_list, opportunity_get,
  // Dispatch Pro (D1 mirrors of native ST reports)
  dispatch_pro_utilization_list, dispatch_pro_ratio_list, dispatch_pro_alerts_list,
] as const;

export function findTool(name: string): ToolDef<any> | undefined {
  return TOOLS.find((t) => t.name === name);
}

/**
 * Derive MCP tool annotations for a tool. Explicit annotations win; otherwise
 * we infer from isWrite: reads are read-only + idempotent; writes are non-read-only.
 * Everything here talks to the ServiceTitan API, so openWorldHint is always true.
 */
export function annotationsFor(tool: ToolDef<any>): Required<ToolAnnotations> {
  const a = tool.annotations ?? {};
  const isWrite = tool.isWrite === true;
  return {
    readOnlyHint: a.readOnlyHint ?? !isWrite,
    destructiveHint: a.destructiveHint ?? false,
    idempotentHint: a.idempotentHint ?? !isWrite,
    openWorldHint: a.openWorldHint ?? true,
  };
}

/**
 * Filter tools by caller role.
 *   - 'lockdown': read-only mode. Strips every isWrite=true tool and adminOnly tools.
 *   - 'admin':    full catalog including the st_call escape hatch.
 *   - 'default':  everything except adminOnly tools.
 */
export function toolsForRole(role: 'default' | 'admin' | 'lockdown'): readonly ToolDef<any>[] {
  if (role === 'lockdown') return TOOLS.filter((t) => !t.isWrite && !t.adminOnly);
  if (role === 'admin') return TOOLS;
  return TOOLS.filter((t) => !t.adminOnly);
}
