// Shared enums — mirror prisma/schema.prisma (single source for the frontend)

export const PARTNER_TYPES = ['CLIENT', 'SUPPLIER', 'PARTNER', 'AUTHORITY'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const OPPORTUNITY_STAGES = [
  'LEAD', 'QUALIFIED', 'GO_NO_GO', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST', 'CANCELLED',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const CONTRACT_STATUSES = [
  'DRAFT', 'IN_REVIEW', 'IN_APPROVAL', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const INVOICE_STATUSES = [
  'DRAFT', 'IN_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_PAID', 'PAID',
  'OVERDUE', 'DISPUTED', 'CANCELLED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_DIRECTIONS = ['OUTGOING', 'INCOMING'] as const;
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number];

export const LEAVE_TYPES = [
  'VACATION', 'SICK', 'SPECIAL', 'UNPAID', 'PARENTAL',
  'OVERTIME_COMPENSATION', 'HOME_OFFICE',
] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const EMPLOYMENT_STATUSES = [
  'ACTIVE', 'ON_LEAVE', 'NOTICE_PERIOD', 'TERMINATED', 'RETIRED',
] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

export const ASSET_STATUSES = [
  'IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'RETIRED', 'LOST', 'SOLD',
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];
