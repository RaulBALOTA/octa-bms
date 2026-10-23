export interface Member { id: string; firstName: string; lastName: string }
export interface CalendarItem {
  id: string; companyId: string; title: string; description: string | null; domain: string; kind: string; status: string;
  sensitivity: string; priority: number; ownerUserId: string | null; createdById: string; owner: Member | null;
  timezoneIana: string; allDay: boolean; dateOnly: string | null; endDateOnly: string | null;
  startsAt: string | null; endsAt: string | null; hardDueAt: string | null;
  hardDueDate: string | null; internalTargetDate: string | null; forecastDate: string | null;
  recurrenceFrequency: string | null; recurrenceInterval: number; recurrenceUntil: string | null;
  completionEvidenceRequired: boolean; sourceKind: string; sourceUrl: string | null;
  businessEntityType: string | null; businessEntityId: string | null; version: number; canEdit: boolean;
  checklist: { id?: string; title: string; done: boolean }[];
  evidence: { id: string; title: string; url: string }[];
  grants: { userId: string; canEdit: boolean }[];
  attention: { score: number; reasons: string[]; overdue: boolean };
}
export interface Capability { enabled: boolean; domains: string[]; entityTypes: string[]; microsoft: { connected: boolean }; ai: { connected: boolean } }
export interface Horizon { items: CalendarItem[]; total: number; truncated: boolean; summary: { critical: number; overdue: number; awaiting: number; missingOwner: number } }
export interface History { id: string; action: string; version: number; createdAt: string; changes: { before: Partial<CalendarItem> | null; after: Partial<CalendarItem> } }
export const KINDS = ['APPOINTMENT', 'DEADLINE', 'OBLIGATION', 'MILESTONE', 'DECISION', 'FORECAST', 'FOLLOW_UP'];
export const STATUSES = ['OPEN', 'IN_PROGRESS', 'AWAITING', 'AT_RISK', 'COMPLETED', 'CANCELED'];
export const SHAPES: Record<string, string> = { APPOINTMENT: '●', DEADLINE: '▲', OBLIGATION: '■', MILESTONE: '◆', DECISION: '⚑', FORECAST: '◇', FOLLOW_UP: '↪' };
