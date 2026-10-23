/**
 * Synthetic, test-only snapshot builders for analytically verifiable engine cases.
 * Not used at runtime and never written to the database.
 */
import type { EngineConfig, EngineSnapshot, SnapshotAssignment, SnapshotDemand, SnapshotResource } from '../../../../../../packages/shared/src/business-engine';
import { DEFAULT_ENGINE_CONFIG, resolveConfig } from './config';

export function testConfig(patch: Record<string, unknown> = {}): EngineConfig {
  return resolveConfig({ calendar: { holidayRegion: 'NONE' }, vat: { enabled: false }, capacity: { defaultNonProjectPct: 0 }, ...patch }, DEFAULT_ENGINE_CONFIG);
}
export function resource(id: string, values: Partial<SnapshotResource> & { costRate?: string; monthlyFixedCost?: string | null } = {}): SnapshotResource {
  const { costRate = '80.00', monthlyFixedCost = null, ...rest } = values;
  return { id, name: id, kind: 'EMPLOYEE', internal: true, weeklyHours: 40, maxAllocationPct: 100, nonProjectPct: 0, activeFrom: null, activeTo: null,
    skills: [], rates: [{ effectiveFrom: '2020-01-01', costRate, billRate: null, monthlyFixedCost }], absences: [], ...rest };
}
export function demand(id: string, values: Partial<SnapshotDemand> = {}): SnapshotDemand {
  return { id, skillId: null, skillName: null, role: id, seniority: 'PROFESSIONAL', hours: 0, start: null, end: null, resourceId: null, sourcing: 'INTERNAL',
    billable: true, costRate: null, externalRate: null, actualHours: 0, remainingHours: null, ...values };
}
export function assignment(id: string, values: Partial<SnapshotAssignment> = {}): SnapshotAssignment {
  return { id, title: id, serviceId: 'svc', serviceName: 'Service', serviceCode: 'SVC', packageId: null, clientId: 'client', clientName: 'Client',
    contractId: 'contract', opportunityId: null, externalProjectRef: null, commitment: 'CONTRACTED', probability: 1, exclusiveGroup: null, shiftableWeeks: 0,
    start: '2026-01-05', end: '2026-02-27', feeModel: 'FIXED_FEE', billing: 'ON_COMPLETION', currency: 'EUR', fixedFee: null, hourlyRate: null, dailyRate: null,
    hoursPerDay: null, monthlyRetainer: null, capexBasis: null, capexPercent: null, paymentTermDays: 30, vatRatePct: 19,
    expenses: { travel: '0', software: '0', other: '0', subcontractFixed: '0' }, milestones: [], adjustments: [], demand: [],
    actuals: { hours: 0, cost: '0', revenue: '0', invoicedNet: '0', percentComplete: null }, baseline: null, targetMarginPct: null,
    externalDeliveryAllowed: true, responsibleUserId: null, strategicScore: null, riskScore: null, ...values };
}
export function snapshot(values: Partial<EngineSnapshot> = {}): EngineSnapshot {
  return { asOf: '2026-01-05', horizonStart: '2026-01-05', horizonEnd: '2026-12-31', currency: 'EUR', config: testConfig(), openingCash: '0.00', openingCashSource: 'MANUAL',
    skills: [], resources: [], assignments: [], openReceivables: [], openPayables: [], actualInvoicedByMonth: [], ...values };
}
