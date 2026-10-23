import { hoursToMinutes, weekStartOf } from './time-domain';

/** A PMO time entry normalised to BMS terms (pulled or pushed). */
export interface IncomingPmoEntry {
  externalId: string;
  email: string | null;
  resourceName: string | null;
  date: string;
  hours: number;
  projectCode: string | null;
  projectName: string | null;
  taskRef: string | null;
  billable: boolean;
  description: string | null;
}

export interface ExistingPmoEntry {
  id: string;
  externalId: string;
  employeeId: string;
  date: string;
  minutes: number;
  projectCode: string;
  projectName: string | null;
  taskRef: string | null;
  billable: boolean;
  description: string | null;
}

export interface PmoEntryData {
  employeeId: string;
  date: string;
  minutes: number;
  projectCode: string;
  projectName: string | null;
  taskRef: string | null;
  billable: boolean;
  description: string | null;
}

export interface PmoImportPlan {
  create: (PmoEntryData & { externalId: string })[];
  update: { id: string; data: PmoEntryData }[];
  remove: string[];
  skipped: { externalId: string; reason: 'LOCKED_WEEK' | 'INVALID' }[];
  unmatched: { email: string | null; resourceName: string | null; entries: number; hours: number }[];
}

export const UNASSIGNED_PROJECT = 'UNASSIGNED';

/**
 * Decide how PMO entries change the BMS mirror.
 *
 * - Entries are matched to employees by e-mail (case-insensitive).
 * - Weeks whose timesheet is submitted or approved are locked: their PMO
 *   entries are neither changed nor removed, and changes are reported as skipped.
 * - `removeFrom` (inclusive) bounds deletions: a mirrored entry on/after that
 *   day that PMO no longer reports is removed. Pass null to never remove (push mode).
 */
export function planPmoImport(input: {
  incoming: IncomingPmoEntry[];
  existing: ExistingPmoEntry[];
  employeesByEmail: Map<string, string>;
  lockedWeeks: Set<string>; // `${employeeId}:${weekStart}`
  removeFrom: string | null;
}): PmoImportPlan {
  const plan: PmoImportPlan = { create: [], update: [], remove: [], skipped: [], unmatched: [] };
  const existing = new Map(input.existing.map((e) => [e.externalId, e]));
  const seen = new Set<string>();
  const unmatched = new Map<string, { email: string | null; resourceName: string | null; entries: number; hours: number }>();
  const locked = (employeeId: string, day: string) => input.lockedWeeks.has(`${employeeId}:${weekStartOf(day)}`);

  for (const entry of input.incoming) {
    seen.add(entry.externalId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(entry.hours) || entry.hours < 0 || entry.hours > 24) {
      plan.skipped.push({ externalId: entry.externalId, reason: 'INVALID' });
      continue;
    }
    const employeeId = entry.email ? input.employeesByEmail.get(entry.email.trim().toLowerCase()) : undefined;
    if (!employeeId) {
      const key = entry.email?.toLowerCase() ?? `name:${entry.resourceName ?? '?'}`;
      const bucket = unmatched.get(key) ?? { email: entry.email, resourceName: entry.resourceName, entries: 0, hours: 0 };
      bucket.entries += 1;
      bucket.hours = Math.round((bucket.hours + entry.hours) * 100) / 100;
      unmatched.set(key, bucket);
      continue;
    }
    const data: PmoEntryData = {
      employeeId,
      date: entry.date,
      minutes: hoursToMinutes(entry.hours),
      projectCode: entry.projectCode?.trim() || entry.projectName?.trim() || UNASSIGNED_PROJECT,
      projectName: entry.projectName?.trim() || null,
      taskRef: entry.taskRef?.trim() || null,
      billable: entry.billable,
      description: entry.description?.trim().slice(0, 500) || null,
    };
    const current = existing.get(entry.externalId);
    if (!current) {
      if (locked(employeeId, data.date)) plan.skipped.push({ externalId: entry.externalId, reason: 'LOCKED_WEEK' });
      else plan.create.push({ ...data, externalId: entry.externalId });
      continue;
    }
    const changed = (Object.keys(data) as (keyof PmoEntryData)[]).some((key) => data[key] !== current[key]);
    if (!changed) continue;
    if (locked(current.employeeId, current.date) || locked(employeeId, data.date)) {
      plan.skipped.push({ externalId: entry.externalId, reason: 'LOCKED_WEEK' });
      continue;
    }
    plan.update.push({ id: current.id, data });
  }

  if (input.removeFrom) {
    for (const entry of input.existing) {
      if (seen.has(entry.externalId) || entry.date < input.removeFrom) continue;
      if (locked(entry.employeeId, entry.date)) plan.skipped.push({ externalId: entry.externalId, reason: 'LOCKED_WEEK' });
      else plan.remove.push(entry.id);
    }
  }
  plan.unmatched = [...unmatched.values()].sort((a, b) => b.hours - a.hours);
  return plan;
}

/**
 * Lower bound for removals after a pull. PMO returns newest entries first and
 * caps the response, so when the cap is hit only the fully covered days (after
 * the oldest returned day) may be pruned.
 */
export function removalBoundary(windowFrom: string, rows: { date: string }[], cap: number): string | null {
  if (rows.length < cap) return windowFrom;
  const oldest = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0]?.date ?? windowFrom);
  if (oldest <= windowFrom) return windowFrom;
  const next = new Date(`${oldest}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
