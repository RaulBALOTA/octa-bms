export type ViolationCode = 'MAX_DAILY_EXCEEDED' | 'BREAK_TOO_SHORT' | 'REST_PERIOD_TOO_SHORT' | 'SUNDAY_HOLIDAY_WORK' | 'MISSING_CLOCK_OUT' | 'WEEKLY_OVER_48';
export type RecordKind = 'OFFICE' | 'HOME_OFFICE' | 'ON_SITE' | 'BUSINESS_TRIP';
export type TimesheetStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface Violation { day: string; code: ViolationCode; severity: 'error' | 'warning'; value?: number; limit?: number }

export interface DaySummary {
  day: string;
  scheduledMinutes: number;
  targetMinutes: number;
  holiday: string | null;
  absence: string | null;
  workedMinutes: number;
  breakMinutes: number;
  projectMinutes: number;
  deltaMinutes: number;
  unallocatedMinutes: number;
  open: boolean;
  violations: Violation[];
}

export interface Totals { targetMinutes: number; workedMinutes: number; projectMinutes: number; deltaMinutes: number; billableMinutes: number }

export interface TimeRecord {
  id: string;
  date: string;
  startAt: string;
  endAt: string | null;
  startTime: string;
  endTime: string | null;
  breakMinutes: number;
  kind: RecordKind;
  note: string | null;
}

export interface ProjectEntry {
  id: string;
  date: string;
  projectCode: string;
  projectName: string | null;
  taskRef: string | null;
  minutes: number;
  hours: number;
  billable: boolean;
  description: string | null;
  source: 'BMS' | 'PMO';
  syncedAt: string | null;
}

export interface Timesheet {
  id?: string;
  status: TimesheetStatus;
  submittedAt?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
}

export interface WeekView {
  employee: { id: string; firstName: string; lastName: string };
  weekStart: string;
  weekEnd: string;
  isoWeek: { year: number; week: number };
  today: string;
  timesheet: Timesheet;
  summary: { days: DaySummary[]; totals: Totals; violations: Violation[] };
  records: TimeRecord[];
  entries: ProjectEntry[];
  openRecord: TimeRecord | null;
  canManage: boolean;
}

export interface Balance { from: string; to: string; targetMinutes: number; workedMinutes: number; projectMinutes: number; balanceMinutes: number; violations: number; vacationDays?: number; sickDays?: number }

export interface ProjectOption { code: string; name: string | null; status: string | null; isActive: boolean; source: 'PMO' | 'BMS' }

export interface TeamRow {
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string; department: string | null };
  totals: Totals;
  violations: number;
  errors: number;
  absenceDays: number;
  timesheet: { id: string | null; status: TimesheetStatus };
}

export interface TimesheetRow {
  id: string;
  weekStart: string;
  isoWeek: { year: number; week: number };
  status: TimesheetStatus;
  targetMinutes: number;
  workedMinutes: number;
  projectMinutes: number;
  violations: Violation[] | null;
  submittedAt: string | null;
  decisionNote: string | null;
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string };
}

export interface CapacityCell {
  weekStart: string;
  capacityMinutes: number;
  plannedMinutes: number;
  actualMinutes: number;
  utilization: number | null;
  allocations: { id: string; projectCode: string; projectName: string | null; plannedMinutes: number; note: string | null }[];
}

export interface CapacityBoard {
  weeks: { weekStart: string; isoWeek: { year: number; week: number } }[];
  rows: { employee: { id: string; firstName: string; lastName: string; department: string | null }; cells: CapacityCell[] }[];
  projects: { projectCode: string; projectName: string | null; plannedMinutes: number; actualMinutes: number; employees: number }[];
}

export interface WorkSchedule {
  id: string;
  code: string;
  name: string;
  dailyMinutes: number[];
  coreStart: string | null;
  coreEnd: string | null;
  isDefault: boolean;
  isActive: boolean;
  weeklyMinutes: number;
  activeAssignments: number;
}

export interface ScheduleAssignment {
  id: string;
  validFrom: string;
  validTo: string | null;
  schedule: { id: string; code: string; name: string };
  employee: { id: string; firstName: string; lastName: string };
}

export interface PmoRun {
  id: string;
  trigger: 'MANUAL' | 'SCHEDULED' | 'PUSH';
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  startedAt: string;
  finishedAt: string | null;
  windowFrom: string | null;
  fetched: number;
  created: number;
  updated: number;
  removed: number;
  skipped: number;
  unmatched: { email: string | null; resourceName: string | null; entries: number; hours: number }[] | null;
  error: string | null;
}

export interface PmoStatus {
  configured: boolean;
  baseUrl: string | null;
  windowDays: number | null;
  scheduled: boolean;
  projects: number;
  mirroredEntries: number;
  runs: PmoRun[];
}
