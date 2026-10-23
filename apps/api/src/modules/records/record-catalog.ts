import { Prisma } from '@prisma/client';

export interface ResourceDefinition {
  model: string; module: string; en: string; de: string;
  scope?: string; fields?: string[]; protected?: string[]; owned?: string[];
  states?: string[]; deleteStates?: string[]; stateField?: string;
  number?: { field: string; prefix: string; sequence: string };
  children?: { field: string; model: string; relation: string; min: number };
  enums?: Record<string, string[]>;
  native?: string; createNative?: boolean;
}
const resource = (model: string, module: string, en: string, de: string, options: Omit<Partial<ResourceDefinition>, 'model' | 'module' | 'en' | 'de'> = {}): ResourceDefinition => ({ model, module, en, de, ...options });
export const RECORD_RESOURCES: Record<string, ResourceDefinition> = {
  companies: resource('Company', 'corporate', 'Companies', 'Gesellschaften', { native: '/group', fields: ['code','name','legalName','legalForm','vatId','taxNumber','commercialRegister','street','postalCode','city','countryCode','phone','email','website','parentCompanyId','defaultCurrency','defaultLocale','fiscalYearStart','isActive'] }),
  offices: resource('Office', 'corporate', 'Offices', 'Standorte', { fields: ['code','name','street','postalCode','city','countryCode','phone','email','isHQ','isActive'] }),
  goals: resource('CompanyGoal', 'corporate', 'Company goals', 'Unternehmensziele', { native: '/corporate', enums: { status: ['ON_TRACK','AT_RISK','OFF_TRACK','ACHIEVED'], category: ['FINANCIAL','GROWTH','PEOPLE','QUALITY','DIGITALIZATION'] } }),
  announcements: resource('Announcement', 'corporate', 'Announcements', 'Mitteilungen', { native: '/corporate', enums: { priority: ['LOW','NORMAL','HIGH','URGENT'] } }),
  calendar: resource('CompanyCalendarEvent', 'corporate', 'Company calendar', 'Unternehmenskalender'),
  departments: resource('Department', 'hr', 'Departments', 'Abteilungen'),
  businessUnits: resource('BusinessUnit', 'corporate', 'Business units', 'Geschäftsbereiche'),
  profitCenters: resource('ProfitCenter', 'finance', 'Profit centers', 'Profitcenter'),
  costCenters: resource('CostCenter', 'finance', 'Cost centers', 'Kostenstellen', { native: '/finance/budgets', createNative: true }),
  partners: resource('BusinessPartner', 'crm', 'Clients, suppliers and partners', 'Kunden, Lieferanten und Partner', { native: '/crm/partners', number: { field: 'partnerNumber', prefix: 'C', sequence: 'partner' }, owned: ['Contact','CrmActivity'] }),
  contacts: resource('Contact', 'crm', 'Contacts', 'Kontakte', { scope: 'partner' }),
  activities: resource('CrmActivity', 'crm', 'Activities', 'Aktivitäten', { scope: 'partner' }),
  opportunities: resource('Opportunity', 'sales', 'Opportunities', 'Verkaufschancen', { native: '/sales/pipeline', number: { field: 'opportunityNumber', prefix: 'OP', sequence: 'opportunity' }, protected: ['stage','wonDate','lostReason'] }),
  competitors: resource('Competitor', 'sales', 'Competitors', 'Wettbewerber'),
  references: resource('ReferenceProject', 'sales', 'Reference projects', 'Referenzprojekte'),
  proposals: resource('Proposal', 'sales', 'Proposals', 'Angebote', { native: '/sales/pipeline', createNative: true, protected: ['status','totalFee','estimatedCost','estimatedHours','marginPercent','proposalNumber'], states: ['DRAFT'], owned: ['FeeCalculationLine','ProposalVersion'] }),
  contracts: resource('Contract', 'contracts', 'Contracts', 'Verträge', { native: '/contracts', number: { field: 'contractNumber', prefix: 'CT', sequence: 'contract' }, protected: ['status'], states: ['DRAFT','IN_REVIEW'], deleteStates: ['DRAFT'], owned: ['ContractVersion','ContractObligation'] }),
  guarantees: resource('BankGuarantee', 'contracts', 'Bank guarantees', 'Bürgschaften', { native: '/contracts/guarantees', protected: ['status'] }),
  insurance: resource('InsurancePolicy', 'contracts', 'Insurance policies', 'Versicherungen', { native: '/contracts/insurance' }),
  obligations: resource('ContractObligation', 'contracts', 'Contract obligations', 'Vertragspflichten', { scope: 'contract', protected: ['isFulfilled','fulfilledAt'] }),
  milestones: resource('PaymentMilestone', 'contracts', 'Payment milestones', 'Zahlungsmeilensteine', { scope: 'contract', protected: ['isInvoiced','invoiceId'] }),
  variations: resource('VariationOrder', 'contracts', 'Variation orders', 'Nachträge', { scope: 'contract', native: '/contracts', protected: ['status','decidedAt'], states: ['DRAFT','SUBMITTED'], deleteStates: ['DRAFT'] }),
  claims: resource('Claim', 'contracts', 'Claims', 'Claims', { scope: 'contract', native: '/contracts', protected: ['status','settledAt','settledAmount'], states: ['OPEN','NOTIFIED','UNDER_REVIEW'], deleteStates: ['OPEN','NOTIFIED'] }),
  invoices: resource('Invoice', 'finance', 'Invoices', 'Rechnungen', { native: '/finance/invoices', number: { field: 'invoiceNumber', prefix: 'R', sequence: 'invoice' }, protected: ['status','netAmount','taxAmount','grossAmount','paidAmount','datevExportedAt','xrechnungId','dunningLevel','lastDunnedAt'], states: ['DRAFT'], owned: ['InvoiceLine'], children: { field: 'lines', model: 'InvoiceLine', relation: 'invoiceId', min: 1 } }),
  bankAccounts: resource('BankAccount', 'finance', 'Bank accounts', 'Bankkonten', { native: '/finance/payments' }),
  payments: resource('Payment', 'finance', 'Payments', 'Zahlungen', { scope: 'bankAccount', native: '/finance/payments', createNative: true, fields: ['reference','counterparty'] }),
  budgets: resource('Budget', 'finance', 'Budgets', 'Budgets', { native: '/finance/budgets', createNative: true, protected: ['status'], states: ['DRAFT'], owned: ['BudgetLine'] }),
  employees: resource('Employee', 'hr', 'Employees', 'Mitarbeiter', { native: '/hr/employees', owned: ['EmployeeSkill','EmployeeCertificate','LeaveBalance','CvProfile'], protected: ['userId'] }),
  positions: resource('Position', 'hr', 'Positions', 'Positionen'),
  skills: resource('Skill', 'hr', 'Skills', 'Kompetenzen'),
  employeeSkills: resource('EmployeeSkill', 'hr', 'Employee skills', 'Mitarbeiterkompetenzen', { scope: 'employee' }),
  certificates: resource('EmployeeCertificate', 'hr', 'Certificates', 'Zertifikate', { scope: 'employee', protected: ['fileId'] }),
  trainings: resource('Training', 'hr', 'Training courses', 'Schulungen'),
  trainingParticipants: resource('TrainingParticipation', 'hr', 'Training participants', 'Schulungsteilnahmen', { scope: 'employee' }),
  leave: resource('LeaveRequest', 'hr', 'Leave requests', 'Abwesenheitsanträge', { scope: 'employee', native: '/hr/leave', createNative: true, protected: ['status','days','approvedById','decidedAt'], fields: ['note'], states: ['REQUESTED'], deleteStates: ['REQUESTED','REJECTED'] }),
  leaveBalances: resource('LeaveBalance', 'hr', 'Leave balances', 'Urlaubskonten', { scope: 'employee', protected: ['taken'] }),
  openings: resource('JobOpening', 'hr', 'Job openings', 'Stellenangebote', { native: '/hr/recruitment', enums: { status: ['OPEN','ON_HOLD','CLOSED'] } }),
  applicants: resource('Applicant', 'hr', 'Applicants', 'Bewerber', { scope: 'jobOpening', native: '/hr/recruitment', protected: ['stage'] }),
  cases: resource('LegalCase', 'legal', 'Legal cases', 'Rechtsfälle', { native: '/legal/cases', enums: { type: ['LITIGATION','ARBITRATION','ADMINISTRATIVE','EMPLOYMENT','IP'], status: ['OPEN','ACTIVE','SETTLED','CLOSED','WON','LOST'] } }),
  compliance: resource('ComplianceItem', 'legal', 'Compliance register', 'Compliance-Register', { native: '/legal', enums: { category: ['GDPR','ISO_9001','ISO_14001','ISO_45001','LICENSE','REGISTER','TAX','OTHER'], status: ['OPEN','IN_PROGRESS','COMPLIANT','NON_COMPLIANT','NOT_APPLICABLE'], recurrence: ['YEARLY','QUARTERLY','MONTHLY'] } }),
  processing: resource('DataProcessingActivity', 'legal', 'Data processing activities', 'Verarbeitungstätigkeiten'),
  professionalLicenses: resource('ProfessionalLicense', 'legal', 'Professional licenses', 'Berufszulassungen'),
  requests: resource('PurchaseRequest', 'procurement', 'Purchase requests', 'Beschaffungsanträge', { native: '/procurement', number: { field: 'requestNumber', prefix: 'PR', sequence: 'purchase-request' }, protected: ['status','totalEstimate'], states: ['DRAFT'], owned: ['PurchaseRequestItem'], children: { field: 'items', model: 'PurchaseRequestItem', relation: 'requestId', min: 1 }, enums: { category: ['IT','SOFTWARE','OFFICE','VEHICLE','FURNITURE','SERVICE','OTHER'] } }),
  orders: resource('PurchaseOrder', 'procurement', 'Purchase orders', 'Bestellungen', { native: '/procurement', number: { field: 'orderNumber', prefix: 'PO', sequence: 'purchase-order' }, protected: ['status','netTotal'], states: ['ORDERED'], deleteStates: ['DRAFT','ORDERED'], owned: ['PurchaseOrderItem'], children: { field: 'items', model: 'PurchaseOrderItem', relation: 'orderId', min: 1 } }),
  evaluations: resource('SupplierEvaluation', 'procurement', 'Supplier evaluations', 'Lieferantenbewertungen', { scope: 'supplier', protected: ['overallScore'] }),
  assets: resource('Asset', 'assets', 'Assets', 'Geräte und Anlagen', { native: '/assets', number: { field: 'assetNumber', prefix: 'AST', sequence: 'asset' }, protected: ['status'], owned: ['MaintenanceRecord'] }),
  maintenance: resource('MaintenanceRecord', 'assets', 'Maintenance records', 'Wartungen', { scope: 'asset' }),
  licenses: resource('SoftwareLicense', 'assets', 'Software licenses', 'Softwarelizenzen', { protected: ['usedSeats'], enums: { licenseType: ['PERPETUAL','SUBSCRIPTION','FLOATING','NAMED_USER'] } }),
  assetCategories: resource('AssetCategory', 'assets', 'Asset categories', 'Gerätekategorien'),
  vehicleTypes: resource('VehicleType', 'assets', 'Vehicle types', 'Fahrzeugtypen'),
  articles: resource('KnowledgeArticle', 'knowledge', 'Knowledge articles', 'Wissensartikel', { native: '/knowledge', protected: ['status','publishedAt','reviewerId','viewCount'], owned: ['ArticleVersion'], enums: { type: ['ARTICLE','STANDARD','PROCEDURE','TEMPLATE','LESSON_LEARNED','FAQ'] } }),
  knowledgeCategories: resource('KnowledgeCategory', 'knowledge', 'Knowledge categories', 'Wissenskategorien'),
  templates: resource('EmailTemplate', 'communication', 'Email templates', 'E-Mail-Vorlagen', { native: '/communication' }),
  meetings: resource('MeetingMinute', 'communication', 'Meeting minutes', 'Besprechungsprotokolle', { native: '/communication', protected: ['status'], states: ['DRAFT'] }),
  workflows: resource('WorkflowDefinition', 'workflow', 'Workflow definitions', 'Workflow-Definitionen', { native: '/workflow', protected: ['version'] }),
  tasks: resource('Task', 'workflow', 'Tasks', 'Aufgaben', { protected: ['completedAt'], enums: { status: ['OPEN','IN_PROGRESS','DONE','CANCELLED'], priority: ['LOW','NORMAL','HIGH','URGENT'] } }),
  dashboards: resource('Dashboard', 'bi', 'Dashboards', 'Dashboards'),
  reports: resource('ReportDefinition', 'bi', 'Report definitions', 'Berichtsdefinitionen'),
  users: resource('User', 'admin', 'User accounts', 'Benutzerkonten', { native: '/admin', fields: ['email','firstName','lastName','displayName','locale','timeZone','theme','isActive'], owned: ['CompanyMembership','UserRole','UserGroup','RefreshToken','ApiKey','Notification'] }),
  roles: resource('Role', 'admin', 'Roles', 'Rollen', { fields: ['code','name','nameDe','description'], protected: ['isSystem'], owned: ['RolePermission'] }),
  groups: resource('Group', 'admin', 'User groups', 'Benutzergruppen', { owned: ['UserGroup'] }),
  countries: resource('Country', 'admin', 'Countries', 'Länder'),
  currencies: resource('Currency', 'admin', 'Currencies', 'Währungen'),
  exchangeRates: resource('ExchangeRate', 'finance', 'Exchange rates', 'Wechselkurse'),
  taxCodes: resource('TaxCode', 'finance', 'Tax codes', 'Steuerschlüssel'),
  contractTypes: resource('ContractTypeRef', 'contracts', 'Contract types', 'Vertragsarten'),
  documentTypes: resource('DocumentTypeRef', 'documents', 'Document types', 'Dokumentarten'),
  languages: resource('LanguageRef', 'admin', 'Languages', 'Sprachen'),
};

export const RECORD_MODELS = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
export const HIDDEN_FIELDS = new Set(['passwordHash','mfaSecret','entraObjectId','mfaEnabled','failedLoginCount','lockedUntil','passwordChangedAt','lastLoginAt']);
export const SYSTEM_FIELDS = new Set(['id','companyId','createdAt','updatedAt','deletedAt','createdById','updatedById','ownerId','authorId','creatorId','requesterId','evaluatedById']);
const LOGICAL_REFERENCES: Record<string, { model: string; key: string }> = {
  currencyCode: { model: 'Currency', key: 'code' }, defaultCurrency: { model: 'Currency', key: 'code' },
  countryCode: { model: 'Country', key: 'code' },
};
export interface RecordField {
  name: string; type: string; required: boolean; nullable: boolean; readOnly: boolean; createOnly?: boolean;
  default?: unknown; values?: string[]; reference?: { model: string; key: string }; list?: boolean; fields?: RecordField[];
}

export function recordFields(definition: ResourceDefinition, child = false): RecordField[] {
  const model = RECORD_MODELS.get(definition.model);
  if (!model) throw new Error(`Unknown record model: ${definition.model}`);
  const fields: RecordField[] = model.fields.filter((field) => field.kind !== 'object' && !HIDDEN_FIELDS.has(field.name)).map((field) => {
    const relation = model.fields.find((relation) => relation.kind === 'object' && relation.relationFromFields?.includes(field.name));
    const employeeReference = relation?.type === 'Employee' || (definition.model === 'PurchaseRequest' && field.name === 'requesterId');
    const readOnly = (SYSTEM_FIELDS.has(field.name) && !(['ownerId','requesterId','evaluatedById'].includes(field.name) && employeeReference)) || definition.protected?.includes(field.name) === true
      || (definition.fields ? !definition.fields.includes(field.name) : false) || definition.number?.field === field.name
      || (child && ['position','netAmount','receivedQty',definition.scope].includes(field.name));
    return { name: field.name, type: field.type, list: field.isList, nullable: !field.isRequired, required: field.isRequired && !field.hasDefaultValue && !readOnly, readOnly,
      ...(field.isId && !field.hasDefaultValue ? { createOnly: true } : {}),
      ...(field.hasDefaultValue && (typeof field.default !== 'object' || field.default === null) ? { default: field.default } : {}),
      ...(field.kind === 'enum' ? { values: Prisma.dmmf.datamodel.enums.find((item) => item.name === field.type)?.values.map((item) => item.name) } : {}),
      ...(definition.enums?.[field.name] ? { values: definition.enums[field.name] } : {}),
      ...(relation ? { reference: { model: relation.type, key: relation.relationToFields?.[0] ?? 'id' } }
        : employeeReference ? { reference: { model: 'Employee', key: 'id' } }
        : field.name === 'assignedUserIds' ? { reference: { model: 'User', key: 'id' } }
        : definition.model === 'Invoice' && field.name === 'contractId' ? { reference: { model: 'Contract', key: 'id' } }
        : LOGICAL_REFERENCES[field.name] ? { reference: LOGICAL_REFERENCES[field.name] } : {}),
    };
  });
  if (definition.model === 'User') fields.push({ name: 'password', type: 'Password', required: true, nullable: false, readOnly: false, createOnly: true });
  if (definition.model === 'User') fields.push({ name: 'roleIds', type: 'String', list: true, required: false, nullable: false, readOnly: false, reference: { model: 'Role', key: 'id' } });
  if (definition.model === 'Role') fields.push({ name: 'permissionCodes', type: 'String', list: true, required: false, nullable: false, readOnly: false, reference: { model: 'Permission', key: 'code' } });
  if (definition.model === 'Group') fields.push({ name: 'userIds', type: 'String', list: true, required: false, nullable: false, readOnly: false, reference: { model: 'User', key: 'id' } });
  if (definition.children) fields.push({ name: definition.children.field, type: 'Rows', required: true, nullable: false, readOnly: false,
    fields: recordFields({ ...definition, model: definition.children.model, scope: definition.children.relation, fields: undefined, children: undefined, number: undefined, protected: ['netAmount','receivedQty'] }, true) });
  return fields;
}
