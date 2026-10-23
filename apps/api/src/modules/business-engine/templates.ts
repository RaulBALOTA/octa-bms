/**
 * Configurable seed templates for the OCTA service taxonomy (spec §6.1) and skills (§7.3).
 * Effort profiles are ILLUSTRATIVE starting points — no prices or rates are seeded. Templates are
 * copied into company-owned services and can be changed, re-parented or retired freely.
 */
export interface SkillTemplate { name: string; nameDe: string; parent?: string }
export const SKILL_TEMPLATES: SkillTemplate[] = [
  { name: 'Project management', nameDe: 'Projektmanagement' },
  { name: 'Contract management', nameDe: 'Vertragsmanagement', parent: 'Project management' },
  { name: 'Project controls', nameDe: 'Projektsteuerung', parent: 'Project management' },
  { name: 'Cost estimation', nameDe: 'Kostenermittlung', parent: 'Project controls' },
  { name: 'Architectural design', nameDe: 'Architekturplanung' },
  { name: 'Civil design', nameDe: 'Tiefbau-/Ingenieurbauplanung' },
  { name: 'Structural calculations', nameDe: 'Tragwerksplanung', parent: 'Civil design' },
  { name: 'Mechanical engineering', nameDe: 'Maschinenbau / TGA' },
  { name: 'Electrical engineering', nameDe: 'Elektrotechnik' },
  { name: 'Industrial utilities', nameDe: 'Industrielle Medienversorgung', parent: 'Mechanical engineering' },
  { name: 'Fire protection', nameDe: 'Brandschutz' },
  { name: 'Permitting coordination', nameDe: 'Genehmigungsmanagement' },
  { name: 'BImSchG procedures', nameDe: 'BImSchG-Verfahren', parent: 'Permitting coordination' },
  { name: 'Tender preparation', nameDe: 'Ausschreibung und Vergabe' },
  { name: 'Construction supervision', nameDe: 'Bauüberwachung' },
  { name: 'Commissioning', nameDe: 'Inbetriebnahme' },
  { name: 'BIM coordination', nameDe: 'BIM-Koordination' },
  { name: 'Business case development', nameDe: 'Business-Case-Entwicklung' },
];

type Req = [skill: string, role: string, seniority: 'JUNIOR' | 'PROFESSIONAL' | 'SENIOR' | 'LEAD' | 'PRINCIPAL', hours: number];
export interface ServiceTemplate { code: string; name: string; category: string; revenueModel: string; weeks: number; requirements: Req[] }

const PM = 'Project management';
export const SERVICE_CATEGORIES = ['STRATEGY', 'PROJECT_MANAGEMENT', 'ENGINEERING', 'PERMITTING', 'PROCUREMENT', 'CONSTRUCTION_MANAGEMENT', 'COMMISSIONING'] as const;
const t = (code: string, name: string, category: (typeof SERVICE_CATEGORIES)[number], revenueModel: string, weeks: number, requirements: Req[]): ServiceTemplate =>
  ({ code, name, category, revenueModel, weeks, requirements });

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  t('A-ADV', 'Strategic investment advisory', 'STRATEGY', 'TIME_AND_MATERIALS', 6, [['Business case development', 'Senior advisor', 'PRINCIPAL', 60]]),
  t('A-BC', 'Business case development', 'STRATEGY', 'FIXED_FEE', 6, [['Business case development', 'Business analyst', 'SENIOR', 80], ['Cost estimation', 'Cost estimator', 'PROFESSIONAL', 40]]),
  t('A-CAPEX', 'CAPEX estimation', 'STRATEGY', 'FIXED_FEE', 4, [['Cost estimation', 'Cost estimator', 'SENIOR', 80]]),
  t('A-CONCEPT', 'Conceptual project development', 'STRATEGY', 'FIXED_FEE', 8, [[PM, 'Project lead', 'SENIOR', 60], ['Architectural design', 'Architect', 'PROFESSIONAL', 80]]),
  t('A-SITE', 'Site and technology evaluation', 'STRATEGY', 'FIXED_FEE', 6, [['Industrial utilities', 'Process/utility engineer', 'SENIOR', 60], ['Civil design', 'Civil engineer', 'PROFESSIONAL', 40]]),
  t('A-FEAS', 'Feasibility study', 'STRATEGY', 'FIXED_FEE', 8, [[PM, 'Study lead', 'SENIOR', 40], ['Industrial utilities', 'Process engineer', 'PROFESSIONAL', 60], ['Cost estimation', 'Cost estimator', 'PROFESSIONAL', 20]]),
  t('A-STRAT', 'Investment implementation strategy', 'STRATEGY', 'FIXED_FEE', 4, [[PM, 'Senior advisor', 'PRINCIPAL', 40]]),
  t('A-MASTER', 'Factory master planning', 'STRATEGY', 'FIXED_FEE', 12, [['Architectural design', 'Master planner', 'LEAD', 120], ['Industrial utilities', 'Utility engineer', 'PROFESSIONAL', 80]]),
  t('B-PM', 'Project management', 'PROJECT_MANAGEMENT', 'RETAINER', 52, [[PM, 'Project manager', 'SENIOR', 1200]]),
  t('B-CTRL', 'Project controls', 'PROJECT_MANAGEMENT', 'RETAINER', 52, [['Project controls', 'Project controller', 'PROFESSIONAL', 600]]),
  t('B-COST', 'Cost management', 'PROJECT_MANAGEMENT', 'TIME_AND_MATERIALS', 52, [['Cost estimation', 'Cost manager', 'SENIOR', 400]]),
  t('B-SCHED', 'Schedule management', 'PROJECT_MANAGEMENT', 'TIME_AND_MATERIALS', 52, [['Project controls', 'Planner', 'PROFESSIONAL', 400]]),
  t('B-RISK', 'Risk management', 'PROJECT_MANAGEMENT', 'TIME_AND_MATERIALS', 52, [['Project controls', 'Risk manager', 'SENIOR', 200]]),
  t('B-REP', 'Project reporting', 'PROJECT_MANAGEMENT', 'RETAINER', 52, [['Project controls', 'Project controller', 'PROFESSIONAL', 200]]),
  t('B-CONTR', 'Contract management', 'PROJECT_MANAGEMENT', 'TIME_AND_MATERIALS', 52, [['Contract management', 'Contract manager', 'SENIOR', 300]]),
  t('B-INTF', 'Interface management', 'PROJECT_MANAGEMENT', 'TIME_AND_MATERIALS', 52, [[PM, 'Interface manager', 'PROFESSIONAL', 300]]),
  t('C-ARCH', 'Architecture', 'ENGINEERING', 'FIXED_FEE', 26, [['Architectural design', 'Architect', 'SENIOR', 600]]),
  t('C-CIVIL', 'Civil engineering', 'ENGINEERING', 'FIXED_FEE', 26, [['Civil design', 'Civil engineer', 'PROFESSIONAL', 500]]),
  t('C-STRUCT', 'Structural engineering', 'ENGINEERING', 'FIXED_FEE', 26, [['Structural calculations', 'Structural engineer', 'SENIOR', 500]]),
  t('C-MECH', 'Mechanical engineering', 'ENGINEERING', 'FIXED_FEE', 26, [['Mechanical engineering', 'Mechanical engineer', 'PROFESSIONAL', 500]]),
  t('C-ELEC', 'Electrical engineering', 'ENGINEERING', 'FIXED_FEE', 26, [['Electrical engineering', 'Electrical engineer', 'PROFESSIONAL', 500]]),
  t('C-UTIL', 'Industrial utilities', 'ENGINEERING', 'FIXED_FEE', 26, [['Industrial utilities', 'Utility engineer', 'SENIOR', 400]]),
  t('C-FIRE', 'Fire protection', 'ENGINEERING', 'FIXED_FEE', 12, [['Fire protection', 'Fire protection engineer', 'SENIOR', 160]]),
  t('C-COORD', 'Engineering coordination', 'ENGINEERING', 'TIME_AND_MATERIALS', 40, [[PM, 'Engineering coordinator', 'SENIOR', 600]]),
  t('C-BIM', 'BIM management', 'ENGINEERING', 'TIME_AND_MATERIALS', 40, [['BIM coordination', 'BIM manager', 'PROFESSIONAL', 400]]),
  t('D-BUILD', 'Building permit coordination', 'PERMITTING', 'FIXED_FEE', 16, [['Permitting coordination', 'Permit coordinator', 'SENIOR', 160]]),
  t('D-BIMSCHG', 'BImSchG permitting coordination', 'PERMITTING', 'FIXED_FEE', 30, [['BImSchG procedures', 'BImSchG specialist', 'LEAD', 300]]),
  t('D-WATER', 'Water-law permitting', 'PERMITTING', 'FIXED_FEE', 20, [['Permitting coordination', 'Permit coordinator', 'SENIOR', 120]]),
  t('D-ENV', 'Environmental permitting coordination', 'PERMITTING', 'FIXED_FEE', 20, [['Permitting coordination', 'Permit coordinator', 'SENIOR', 120]]),
  t('D-FIRE', 'Fire authority coordination', 'PERMITTING', 'FIXED_FEE', 8, [['Fire protection', 'Fire protection engineer', 'SENIOR', 60]]),
  t('D-OTHER', 'Other authority approvals', 'PERMITTING', 'TIME_AND_MATERIALS', 12, [['Permitting coordination', 'Permit coordinator', 'PROFESSIONAL', 80]]),
  t('E-STRAT', 'Procurement strategy', 'PROCUREMENT', 'FIXED_FEE', 4, [['Tender preparation', 'Procurement lead', 'SENIOR', 60]]),
  t('E-PREQ', 'Prequalification', 'PROCUREMENT', 'FIXED_FEE', 6, [['Tender preparation', 'Procurement engineer', 'PROFESSIONAL', 80]]),
  t('E-DOCS', 'Tender documentation', 'PROCUREMENT', 'FIXED_FEE', 10, [['Tender preparation', 'Tender engineer', 'PROFESSIONAL', 240]]),
  t('E-MGMT', 'Tender management', 'PROCUREMENT', 'TIME_AND_MATERIALS', 12, [['Tender preparation', 'Procurement lead', 'SENIOR', 160]]),
  t('E-TECH', 'Technical evaluation', 'PROCUREMENT', 'TIME_AND_MATERIALS', 4, [['Mechanical engineering', 'Discipline engineer', 'SENIOR', 80]]),
  t('E-COMM', 'Commercial evaluation', 'PROCUREMENT', 'TIME_AND_MATERIALS', 4, [['Cost estimation', 'Cost manager', 'SENIOR', 60]]),
  t('E-AWARD', 'Contract award support', 'PROCUREMENT', 'TIME_AND_MATERIALS', 4, [['Contract management', 'Contract manager', 'SENIOR', 60]]),
  t('F-COORD', 'Construction coordination', 'CONSTRUCTION_MANAGEMENT', 'RETAINER', 40, [['Construction supervision', 'Construction manager', 'SENIOR', 1200]]),
  t('F-SUPER', 'Site supervision', 'CONSTRUCTION_MANAGEMENT', 'RETAINER', 40, [['Construction supervision', 'Site supervisor', 'PROFESSIONAL', 1400]]),
  t('F-QM', 'Quality management', 'CONSTRUCTION_MANAGEMENT', 'TIME_AND_MATERIALS', 40, [['Construction supervision', 'Quality engineer', 'PROFESSIONAL', 400]]),
  t('F-SCHED', 'Schedule monitoring', 'CONSTRUCTION_MANAGEMENT', 'TIME_AND_MATERIALS', 40, [['Project controls', 'Planner', 'PROFESSIONAL', 300]]),
  t('F-PROG', 'Progress monitoring', 'CONSTRUCTION_MANAGEMENT', 'TIME_AND_MATERIALS', 40, [['Project controls', 'Project controller', 'PROFESSIONAL', 200]]),
  t('F-ADMIN', 'Contract administration', 'CONSTRUCTION_MANAGEMENT', 'TIME_AND_MATERIALS', 40, [['Contract management', 'Contract administrator', 'PROFESSIONAL', 300]]),
  t('F-CLAIM', 'Variation and claim support', 'CONSTRUCTION_MANAGEMENT', 'TIME_AND_MATERIALS', 20, [['Contract management', 'Claims manager', 'LEAD', 160]]),
  t('F-COMPL', 'Completion management', 'CONSTRUCTION_MANAGEMENT', 'FIXED_FEE', 8, [['Construction supervision', 'Construction manager', 'SENIOR', 120]]),
  t('G-PLAN', 'Commissioning planning', 'COMMISSIONING', 'FIXED_FEE', 6, [['Commissioning', 'Commissioning manager', 'SENIOR', 120]]),
  t('G-COORD', 'Commissioning coordination', 'COMMISSIONING', 'TIME_AND_MATERIALS', 10, [['Commissioning', 'Commissioning engineer', 'PROFESSIONAL', 300]]),
  t('G-TEST', 'Inspection and testing coordination', 'COMMISSIONING', 'TIME_AND_MATERIALS', 8, [['Commissioning', 'Test coordinator', 'PROFESSIONAL', 160]]),
  t('G-PUNCH', 'Punch-list management', 'COMMISSIONING', 'TIME_AND_MATERIALS', 6, [['Construction supervision', 'Site supervisor', 'PROFESSIONAL', 100]]),
  t('G-ASBUILT', 'As-built documentation coordination', 'COMMISSIONING', 'FIXED_FEE', 6, [['BIM coordination', 'Documentation coordinator', 'PROFESSIONAL', 120]]),
  t('G-HANDOVER', 'Acceptance and handover', 'COMMISSIONING', 'FIXED_FEE', 4, [[PM, 'Project manager', 'SENIOR', 60]]),
];

export interface PackageTemplate { code: string; name: string; services: string[] }
export const PACKAGE_TEMPLATES: PackageTemplate[] = [
  { code: 'PKG-FEAS', name: 'Factory Feasibility Package', services: ['A-SITE', 'A-FEAS', 'A-CAPEX'] },
  { code: 'PKG-CAPEX', name: 'CAPEX Project Definition Package', services: ['A-CONCEPT', 'A-BC', 'A-CAPEX', 'A-STRAT'] },
  { code: 'PKG-PERMIT', name: 'Permit Coordination Package', services: ['D-BUILD', 'D-BIMSCHG', 'D-FIRE'] },
  { code: 'PKG-TENDER', name: 'Tendering Package', services: ['E-STRAT', 'E-DOCS', 'E-MGMT', 'E-TECH', 'E-COMM', 'E-AWARD'] },
  { code: 'PKG-ENGCOORD', name: 'Engineering Coordination Package', services: ['C-COORD', 'C-BIM'] },
  { code: 'PKG-PMRET', name: 'Project Management Retainer', services: ['B-PM', 'B-CTRL', 'B-REP'] },
  { code: 'PKG-CM', name: 'Construction Management Package', services: ['F-COORD', 'F-SUPER', 'F-QM', 'F-ADMIN', 'F-COMPL'] },
];
