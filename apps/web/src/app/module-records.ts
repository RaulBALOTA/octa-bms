/** Related data stays on the owning module route, alongside its primary list. */
export const MODULE_RECORDS: Record<string, string[]> = {
  '/crm/partners': ['contacts','activities'],
  '/sales/pipeline': ['competitors','references'],
  '/hr/employees': ['departments','positions','skills','employeeSkills','certificates','trainings','trainingParticipants'],
  '/hr/org-chart': ['departments','positions'],
  '/hr/leave': ['leaveBalances'],
  '/hr/recruitment': ['positions'],
  '/assets': ['maintenance','licenses','assetCategories','vehicleTypes'],
  '/corporate': ['businessUnits','calendar'],
  '/contracts': ['obligations','milestones','variations','claims','contractTypes'],
  '/contracts/guarantees': ['contractTypes'],
  '/finance/invoices': ['taxCodes','currencies','exchangeRates'],
  '/finance/payments': ['bankAccounts'],
  '/finance/budgets': ['profitCenters'],
  '/legal': ['processing','professionalLicenses'],
  '/legal/cases': ['processing','professionalLicenses'],
  '/procurement': ['orders','evaluations'],
  '/knowledge': ['knowledgeCategories'],
  '/workflow': ['tasks'],
  '/bi': ['dashboards','reports'],
  '/admin': ['groups','countries','currencies','languages','documentTypes'],
};
export const MODULE_ARCHIVES: Record<string, string[]> = {
  '/sales/pipeline': ['opportunities','proposals'], '/knowledge': ['articles'], '/workflow': ['workflows'],
  '/contracts/guarantees': ['guarantees'], '/contracts/insurance': ['insurance'], '/hr/recruitment': ['openings','applicants'],
  '/communication': ['meetings','templates'], '/admin': ['users','roles'], '/corporate': ['goals','announcements'], '/group': ['companies','offices'],
};
export function relatedModuleRecords(path: string): string[] {
  return MODULE_RECORDS[path] ?? Object.entries(MODULE_RECORDS).filter(([route]) => path.startsWith(`${route}/`)).sort(([a], [b]) => b.length - a.length)[0]?.[1] ?? [];
}
